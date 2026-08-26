'use strict';
/**
 * AI 助手模块 —— 投聊 x OpenClaw 对接（方案 B：机器人账号）
 *
 * 流程：
 *  用户给「天问」(AI 账号) 发私聊消息
 *    → messages.service.send() 落库后调用 maybeReply()
 *    → 本模块向 OpenClaw chatCompletions 接口请求回复
 *    → 以 AI 账号身份写入回复消息 + Socket.IO 广播
 *
 * 设计要点：
 *  - 异步触发，不阻塞用户消息发送响应
 *  - 通过 AI_BOT_ID 识别 AI 账号，避免 AI 回复自己触发死循环
 *  - 超时/失败静默降级（不影响主链路）
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { writeAsync } = require('../../db/writer');
const config = require('../../config');
const { buildMessage } = require('../messages/shared');
const broadcaster = require('../../realtime/broadcaster');

const AI_BOT_ID = (config.ai && config.ai.botId) || '';
const HERMES_BOT_ID = (config.ai && config.ai.hermesBotId) || '';

// 机器人账号 → 大脑路由表（每个 AI 账号绑定自己的 provider 和身份）
const BOTS = [
  {
    botId: AI_BOT_ID,
    provider: 'openclaw',
    name: '天问',
    systemPrompt: '你是「天问」，投聊（touliao.cc）里的 AI 助手，由 OpenClaw 驱动，能写代码、跑任务、查资料、自动化干活。回答简洁、口语化、像真人朋友聊天，不要用客套话开场。',
  },
  {
    botId: HERMES_BOT_ID,
    provider: 'hermes',
    name: 'Hermes',
    systemPrompt: '你是「Hermes」，投聊（touliao.cc）里的 AI 助手，由 Hermes 驱动，底层模型是 DeepSeek。回答简洁、口语化、像真人朋友聊天，不要用客套话开场。',
  },
].filter(b => b.botId);
const botMap = new Map(BOTS.map(b => [b.botId, b]));

// 会话级串行锁：同一会话同时只处理一个 AI 请求，防止乱序
const convLocks = new Map();

function getConversationOtherId(convId, senderId) {
  const row = db.prepare(
    'SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id!=?'
  ).get(convId, senderId);
  return row ? row.user_id : null;
}

function isPrivateConversation(convId) {
  const row = db.prepare('SELECT type FROM conversations WHERE id=?').get(convId);
  return row && row.type === 'private';
}

/**
 * 判断一条消息是否需要触发 AI 回复。
 * 条件：私聊 + 对方是任一 AI 账号 + 发送者不是 AI 自己 + 文本/图片消息
 */
function shouldReply(convId, senderId, msg) {
  if (!msg || (msg.type !== 'text' && msg.type !== 'image')) return false;
  if (botMap.has(senderId)) return false; // AI 不回自己
  if (!isPrivateConversation(convId)) return false;
  const otherId = getConversationOtherId(convId, senderId);
  return botMap.has(otherId);
}

/**
 * 图片消息 → 用视觉模型（智谱 glm-4v-flash）识别内容，返回文字描述。
 * 失败时抛错由调用方降级（回复“看不了图”的提示）。
 */
async function describeImage(fileUrl) {
  const ai = config.ai || {};
  const key = ai.glmApiKey || process.env.GLM_API_KEY || '';
  if (!key) throw new Error('未配置 GLM_API_KEY');

  // fileUrl 形如 /uploads/files/xxx.png → 落到 UPLOADS_ROOT（默认 /var/www/touliao-uploads）
  const fs = require('fs');
  const path = require('path');
  const root = config.uploadsRoot || '/var/www/touliao-uploads';
  const rel = fileUrl.replace(/^\/+uploads\/?/, '');
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) throw new Error('图片文件不存在: ' + abs);

  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.gif' ? 'image/gif'
    : ext === '.webp' ? 'image/webp'
    : ext === '.bmp' ? 'image/bmp'
    : 'image/png';
  const b64 = fs.readFileSync(abs).toString('base64');

  const body = {
    model: 'glm-4v-flash',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '请用中文详细描述这张图片的内容：画面主体、场景、图中文字（若有）、你想提醒用户注意的细节。只输出描述本身。' },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
      ],
    }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`视觉识别 HTTP ${res.status}: ${text.slice(0, 150)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('视觉识别返回空');
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}


/**
 * 清理 AI 大脑回复中混入的工具调试文本（OpenClaw 执行工具失败时会带
 * "⚠️ 🛠️ Exec failed: ..." 之类的行），避免污染聊天内容。
 */
function cleanAiContent(text) {
  if (!text) return text;
  return text
    // 去掉整行工具失败调试文本（含前置空行）
    .replace(/\n?⚠️\s*🛠️?\s*Exec failed:[^\n]*/g, '')
    .replace(/\n?Exec failed:[^\n]*/g, '')
    // 清理可能残留的多个连续空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 调用指定机器人绑定的 AI 大脑（OpenClaw 或 Hermes）。
 * @returns {Promise<string>} 回复文本；失败时抛错由调用方降级
 */
async function askAI(bot, userContent, history = []) {
  const ai = config.ai || {};
  const provider = bot.provider === 'hermes' ? 'hermes' : 'openclaw';
  const baseUrl = provider === 'hermes' ? (ai.hermesUrl || 'http://127.0.0.1:8642') : (ai.openclawUrl || 'http://127.0.0.1:18789');
  const token   = provider === 'hermes' ? (ai.hermesToken || '') : (ai.openclawToken || '');
  const model   = provider === 'hermes' ? (ai.hermesModel || 'deepseek-v4-flash') : (ai.openclawModel || 'openclaw');

  const messages = [
    { role: 'system', content: bot.systemPrompt },
    // 附上最近 10 条上下文（可选，由调用方传入）
    ...history.map(h => ({ role: h.sender_id === bot.botId ? 'assistant' : 'user', content: h.content })),
    { role: 'user', content: userContent },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000); // 60s 超时

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 每次请求独立 Hermes 会话,避免同一会话的长任务(如"天问去做XX"多轮工具调用)
        // 阻塞后续消息导致 60s 超时 abort。上下文由本服务拼的 history 提供,无需服务端会话。
        'X-Hermes-Session-Id': uuidv4(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ model, messages, max_tokens: 800 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${provider} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${provider} 返回空内容`);
    return cleanAiContent(content);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 触发 AI 回复（fire-and-forget）。由 messages.service.send() 在落库后调用。
 * 返回 Promise 供测试；生产调用方可直接 .catch(() => {}) 忽略。
 */
async function maybeReply(io, convId, senderId, msg) {
  if (!shouldReply(convId, senderId, msg)) return null;

  // 对方（AI 账号）决定用哪个大脑
  const otherId = getConversationOtherId(convId, senderId);
  const bot = botMap.get(otherId);
  if (!bot) return null;

  // 会话级串行锁
  if (convLocks.get(convId)) return null;
  convLocks.set(convId, true);
  try {
    // 取最近 10 条消息作为上下文（不含当前消息，当前消息单独作为 user 消息）
    const history = db.prepare(
      `SELECT sender_id, content FROM messages
       WHERE conversation_id=? AND deleted=0 AND type='text'
       ORDER BY rowid DESC LIMIT 10`
    ).all(convId).reverse();

    // 图片消息：先用视觉模型识别，把图片描述转成文字再喂给大脑（大脑是纯文本模型）
    let userContent = msg.content || '';
    if (msg.type === 'image') {
      const desc = await describeImage(msg.file_url || msg.content).catch((e) => {
        console.warn('[AI助手] 图片识别失败:', e.message);
        return '[图片识别失败，请提醒用户图片无法查看]';
      });
      userContent = `[用户发来一张图片，以下是图片内容描述]\n${desc}`;
    }

    const replyText = await askAI(bot, userContent, history);

    const id = uuidv4();
    await writeAsync(
      'INSERT INTO messages (id,conversation_id,sender_id,type,content) VALUES (?,?,?,?,?)',
      [id, convId, bot.botId, 'text', replyText]
    );

    const replyMsg = buildMessage(id);
    if (replyMsg) broadcaster.broadcastMessage(convId, replyMsg);
    return replyMsg;
  } catch (err) {
    console.warn('[AI助手] 回复失败:', err.message);
    return null;
  } finally {
    convLocks.delete(convId);
  }
}

module.exports = { maybeReply, shouldReply, askAI, get AI_BOT_ID() { return AI_BOT_ID; }, get HERMES_BOT_ID() { return HERMES_BOT_ID; } };
