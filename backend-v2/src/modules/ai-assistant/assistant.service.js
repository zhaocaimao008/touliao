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
// 处理期间新到的消息进 convPending 队列，当前请求完成后自动补发（不丢弃）
const convLocks = new Map();
const convPending = new Map(); // convId -> [{senderId, msg}]

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
 * 检测大脑返回的错误文本（Hermes gateway 重启/排空时会把
 * "Operation interrupted: waiting for model response"、"Gateway is draining"
 * 等错误信息当作回复内容返回）。命中时视为调用失败，不落库。
 */
function isErrorContent(text) {
  if (!text) return false;
  const patterns = [
    /^Operation interrupted/i,
    /waiting for model response/i,
    /gateway is draining/i,
    /gateway_draining/i,
    /HTTP 50\d/i,
    /This operation was aborted/i,
    /^Error:\s*$/i,
  ];
  return patterns.some(p => p.test(text));
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
  // 大脑处理投聊消息时需加载完整上下文（2w+ tokens）+ 可能执行工具，
  // 高峰期响应可达 60-120s，60s 超时太紧导致回复被掐断（表现为“机器人不说话”）
  const timer = setTimeout(() => controller.abort(), 180000); // 180s 超时

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
    const cleaned = cleanAiContent(content);
    // Hermes gateway 重启/排空期间会把错误文本当回复内容返回 → 视为失败，不落库
    if (isErrorContent(cleaned)) {
      throw new Error(`${provider} 返回错误文本: ${cleaned.slice(0, 100)}`);
    }
    return cleaned;
  } finally {
    clearTimeout(timer);
  }
}

// ── 图片消息合并窗口 ──
// 用户常先发图、紧跟一条文字说明意图。图片消息先挂起（最多 IMG_MERGE_WINDOW ms），
// 若窗口内有文字到达则合并成一次 AI 请求（图片描述 + 用户文字），否则到期单独处理。
// 修复：之前窗口 3s 太短——用户发图后打字思考常超过 3s，文字独立请求导致 AI「没收到图片」；
// 放宽到 15s 覆盖正常打字间隔；纯发图场景 15s 后立即单独识别回复，不影响体验。
const IMG_MERGE_WINDOW = 15000;
const imgBuffer = new Map(); // convId -> { timer, images: [msg, ...] }

/**
 * 触发 AI 回复（fire-and-forget）。由 messages.service.send() 在落库后调用。
 * 返回 Promise 供测试；生产调用方可直接 .catch(() => {}) 忽略。
 */
function maybeReply(io, convId, senderId, msg) {
  if (!shouldReply(convId, senderId, msg)) return Promise.resolve(null);

  // 对方（AI 账号）决定用哪个大脑
  const otherId = getConversationOtherId(convId, senderId);
  const bot = botMap.get(otherId);
  if (!bot) return Promise.resolve(null);

  // 图片消息：挂起等待可能的文字补充（最多累积 3 张防刷图堆积）
  if (msg.type === 'image') {
    const prev = imgBuffer.get(convId);
    if (prev) clearTimeout(prev.timer);
    const images = prev ? [...prev.images, msg].slice(-3) : [msg];
    const timer = setTimeout(() => {
      imgBuffer.delete(convId);
      // 窗口内没有文字补充：以最后一张图片为 trigger，全部图片描述合并成一次请求
      processQueued(io, convId, msg, bot, images).catch(() => {});
    }, IMG_MERGE_WINDOW);
    imgBuffer.set(convId, { timer, images });
    return Promise.resolve(null);
  }

  // 文字消息：若窗口内有挂起的图片 → 合并成一次请求（图片描述 + 用户文字）
  const pending = imgBuffer.get(convId);
  if (pending) {
    clearTimeout(pending.timer);
    imgBuffer.delete(convId);
    return processQueued(io, convId, msg, bot, pending.images);
  }

  // 普通文字：立即处理
  return processQueued(io, convId, msg, bot, []);
}

/** 带会话级串行锁的 AI 回复入口（含待处理队列补发） */
async function processQueued(io, convId, triggerMsg, bot, images = []) {
  const senderId = triggerMsg.sender_id;
  // 会话级串行锁：正在处理时新消息进待处理队列（最多挂 3 条防堆积），不静默丢弃
  if (convLocks.get(convId)) {
    const q = convPending.get(convId) || [];
    if (q.length < 3) q.push({ senderId, msg: triggerMsg, images });
    convPending.set(convId, q);
    return null;
  }
  convLocks.set(convId, true);
  try {
    await doReply(io, convId, senderId, triggerMsg, bot, images);
    // 当前消息处理完后，依次补发排队中的消息
    while (convPending.has(convId) && convPending.get(convId).length > 0) {
      const next = convPending.get(convId).shift();
      await doReply(io, convId, next.senderId, next.msg, bot, next.images);
    }
    convPending.delete(convId);
    return null;
  } catch (err) {
    console.warn('[AI助手] 回复失败:', err.message);
    return null;
  } finally {
    convLocks.delete(convId);
  }
}

/** 单条（或图片+文字合并的）AI 回复逻辑（上下文 + 图片识别 + 调大脑 + 落库广播） */
async function doReply(io, convId, senderId, msg, bot, images = []) {
  // 取最近 10 条文字消息作为上下文（排除当前消息，当前消息单独作为 user 消息）
  const history = db.prepare(
    `SELECT sender_id, content FROM messages
     WHERE conversation_id=? AND deleted=0 AND type='text' AND id!=?
     ORDER BY rowid DESC LIMIT 10`
  ).all(convId, msg.id).reverse();

  // 图片消息：先用视觉模型识别，把图片描述转成文字再喂给大脑（大脑是纯文本模型）
  let userContent = msg.content || '';
  if (images.length > 0) {
    // 合并场景：先发图后补文字 → 图片描述 + 用户文字，一次请求
    const descParts = [];
    for (const im of images.slice(0, 3)) {
      const d = await describeImage(im.file_url || im.content).catch((e) => {
        console.warn('[AI助手] 图片识别失败:', e.message);
        return '[图片识别失败，请提醒用户图片无法查看]';
      });
      descParts.push(d);
    }
    userContent = `[用户发来${images.length > 1 ? images.length + ' 张' : '一张'}图片，以下是图片内容描述]\n${descParts.join('\n---\n')}`;
    const caption = msg.type === 'text' ? (msg.content || '').trim() : '';
    if (caption) userContent += `\n\n[用户接着说]\n${caption}`;
  } else if (msg.type === 'image') {
    // 兜底：图片未走合并缓冲时直接识别（正常流程图片都进 imgBuffer）
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
}

module.exports = { maybeReply, shouldReply, askAI, get AI_BOT_ID() { return AI_BOT_ID; }, get HERMES_BOT_ID() { return HERMES_BOT_ID; } };
