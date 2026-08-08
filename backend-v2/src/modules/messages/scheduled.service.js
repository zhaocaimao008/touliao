'use strict';
/**
 * 定时消息服务：创建 + 取消 + 列表 + 进程内调度器。
 *
 * 设计要点（对齐任务书硬性约束）：
 *   1) 定时消息存 scheduled_messages 表（pending/sending/sent/cancelled）。
 *   2) 调度器每 30s 扫一次到期(pending 且 send_at<=now)消息，用 CAS 抢占 status
 *      防重复发送，再复用普通发消息核心逻辑（写 messages + 广播 + 推送）发出。
 *   3) 服务重启后 pending 未到期消息保留在库；startScheduler() 启动即扫一次并注册
 *      30s 定时器，实现重启后自动恢复（无需持久化定时器句柄）。
 *   4) 发出的消息带 is_scheduled=1，供前端渲染「定时」标记。
 *
 * 与红包过期回收(startExpiryReclaim)保持同一「启动首扫 + setInterval + unref」风格。
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { writeAsync } = require('../../db/writer');
const config = require('../../config');
const { badRequest, forbidden, notFound } = require('../../utils/http');
const { requireMember, buildMessage } = require('./shared');
const { pushNewMessage } = require('../../utils/push');
const broadcaster = require('../../realtime/broadcaster');
const cache = require('../../utils/cache');

const MAX = config.limits.maxMsgLength;
// 允许的提前量：最少 15 分钟，最多 30 天（任务书硬性区间）
const MIN_DELTA = 15 * 60;
const MAX_DELTA = 30 * 24 * 3600;

// ── 创建定时消息 ────────────────────────────────────────────────
function scheduleMessage(userId, { conversation_id, content, type = 'text', send_at }) {
  if (!conversation_id || !content || send_at == null) throw badRequest('参数缺失');
  if (type !== 'text') throw badRequest('定时消息目前仅支持文本类型');
  if (typeof content !== 'string' || !content.trim()) throw badRequest('消息内容不能为空');
  if (content.length > MAX) throw badRequest(`消息内容不能超过 ${MAX} 个字符`);

  const sendAt = Number(send_at);
  if (!Number.isFinite(sendAt)) throw badRequest('发送时间格式不正确');
  const now = Math.floor(Date.now() / 1000);
  const delta = sendAt - now;
  if (delta < MIN_DELTA) throw badRequest('发送时间至少需在 15 分钟后');
  if (delta > MAX_DELTA) throw badRequest('发送时间最多为 30 天内');

  // 必须是会话成员才能定时发送（与普通发消息一致的权限门控）
  requireMember(conversation_id, userId, '无权在该会话发送');

  const id = uuidv4();
  db.prepare(
    'INSERT INTO scheduled_messages (id,conversation_id,sender_id,content,type,send_at) VALUES (?,?,?,?,?,?)'
  ).run(id, conversation_id, userId, content.trim(), type, sendAt);

  return db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(id);
}

// ── 取消定时消息（仅发送者本人，仅 pending 可取消）────────────────
function cancelScheduledMessage(userId, id) {
  const row = db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(id);
  if (!row) throw notFound('定时消息不存在');
  if (row.sender_id !== userId) throw forbidden('只能取消自己的定时消息');
  if (row.status !== 'pending') throw badRequest('该消息已发送或已取消，无法取消');
  db.prepare("UPDATE scheduled_messages SET status='cancelled' WHERE id=? AND status='pending'").run(id);
  return { success: true };
}

// ── 我的定时消息列表（默认只看 pending，按发送时间升序）────────────
function listScheduledMessages(userId, status = 'pending') {
  const safeStatus = ['pending', 'sent', 'cancelled'].includes(status) ? status : 'pending';
  return db.prepare(
    'SELECT * FROM scheduled_messages WHERE sender_id=? AND status=? ORDER BY send_at ASC LIMIT 100'
  ).all(userId, safeStatus);
}

// ── 发送一条到期定时消息（复用普通发消息落库+广播+推送逻辑）────────
async function deliverOne(sched) {
  const msgId = uuidv4();
  // is_scheduled=1 标记来源，供前端渲染「定时」气泡
  await writeAsync(
    'INSERT INTO messages (id,conversation_id,sender_id,type,content,is_scheduled) VALUES (?,?,?,?,?,1)',
    [msgId, sched.conversation_id, sched.sender_id, sched.type, sched.content]
  );
  cache.delPattern(`search:*${sched.sender_id}*`).catch(() => {});
  cache.del(cache.keys.conversations(sched.sender_id)).catch(() => {});

  const msg = buildMessage(msgId);
  if (msg) {
    broadcaster.broadcastMessage(sched.conversation_id, msg);
    const sender = db.prepare('SELECT username FROM users WHERE id=?').get(sched.sender_id);
    // 定时消息到点也走推送（勿扰时段由 push 层判断），送达离线成员
    pushNewMessage({
      conversationId: sched.conversation_id,
      senderId: sched.sender_id,
      senderName: sender?.username || '',
      content: sched.content,
      type: sched.type,
      timestamp: msg.created_at,
      onlineUserIds: new Set(),
    }).catch(() => {});
  }
  return msg;
}

// ── 扫描并发送所有到期的 pending 消息 ────────────────────────────
async function sendDueMessages() {
  const now = Math.floor(Date.now() / 1000);
  const dues = db.prepare(
    "SELECT * FROM scheduled_messages WHERE status='pending' AND send_at<=? ORDER BY send_at ASC LIMIT 50"
  ).all(now);

  let sent = 0;
  for (const sched of dues) {
    // CAS 抢占 status，防止定时器重入/多进程并发重复发送
    const upd = db.prepare(
      "UPDATE scheduled_messages SET status='sending' WHERE id=? AND status='pending'"
    ).run(sched.id);
    if (upd.changes === 0) continue;

    try {
      // 发送前二次校验：发送者仍是会话成员（退群/会话解散则跳过并标记 cancelled）
      const stillMember = db.prepare(
        'SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?'
      ).get(sched.conversation_id, sched.sender_id);
      if (!stillMember) {
        db.prepare("UPDATE scheduled_messages SET status='cancelled' WHERE id=?").run(sched.id);
        continue;
      }
      await deliverOne(sched);
      db.prepare("UPDATE scheduled_messages SET status='sent' WHERE id=?").run(sched.id);
      sent += 1;
    } catch (e) {
      console.error('[scheduled] 发送失败，恢复 pending 待重试:', sched.id, e.message);
      // 失败恢复 pending，避免永久卡在 sending
      db.prepare("UPDATE scheduled_messages SET status='pending' WHERE id=? AND status='sending'").run(sched.id);
    }
  }
  return sent;
}

// ── 启动调度器（启动首扫 + 每 30s 定时，unref 不阻塞进程退出）──────
let _timer = null;
function startScheduler() {
  if (_timer) return _timer;
  sendDueMessages().catch(e => console.error('[scheduled] 启动扫描失败:', e.message));
  _timer = setInterval(() => {
    sendDueMessages().catch(e => console.error('[scheduled] 定时扫描失败:', e.message));
  }, 30 * 1000);
  _timer.unref?.();
  return _timer;
}

module.exports = {
  scheduleMessage, cancelScheduledMessage, listScheduledMessages,
  sendDueMessages, startScheduler, MIN_DELTA, MAX_DELTA,
};
