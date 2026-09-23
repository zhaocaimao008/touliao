'use strict';
/** Durable scheduler. Delivery, sequence event and sent state share one immediate
 * transaction. A stable task-derived message ID identifies committed work.
 * Notification errors never requeue committed messages; offline devices sync.
 * Legacy random-ID sending rows are exposed as recovery_required.
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { appendConversationEventTx, emitSyncAvailable } = require('./sync.service');
const config = require('../../config');
const { badRequest, forbidden, notFound } = require('../../utils/http');
const { requireMember, buildMessage, privateSendGuard } = require('./shared');
const { pushNewMessage } = require('../../utils/push');
const broadcaster = require('../../realtime/broadcaster');
const cache = require('../../utils/cache');
const convSvc = require('../conversations/conversations.service');

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
    'INSERT INTO scheduled_messages (id,conversation_id,sender_id,content,type,send_at,delivery_version) VALUES (?,?,?,?,?,?,1)'
  ).run(id, conversation_id, userId, content.trim(), type, sendAt);

  return db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(id);
}

// ── 取消定时消息（仅发送者本人，pending / recovery_required 可取消；取消歧义任务只停止重发，不撤回已提交消息）────────────────
function cancelScheduledMessage(userId, id) {
  const row = db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(id);
  if (!row) throw notFound('定时消息不存在');
  if (row.sender_id !== userId) throw forbidden('只能取消自己的定时消息');
  if (!['pending', 'recovery_required'].includes(row.status)) throw badRequest('该消息已发送或已取消，无法取消');
  const cancelled = db.prepare("UPDATE scheduled_messages SET status='cancelled' WHERE id=? AND status IN ('pending','recovery_required')").run(id);
  if (!cancelled.changes) throw badRequest('发送状态已变化，请刷新后核对');
  return { success: true };
}

// ── 我的定时消息列表（默认只看 pending，按发送时间升序）────────────
function listScheduledMessages(userId, status = 'pending') {
  const safeStatus = ['pending', 'sent', 'cancelled', 'recovery_required'].includes(status) ? status : 'pending';
  return db.prepare(
    "SELECT * FROM scheduled_messages WHERE sender_id=? AND (status=? OR (?='pending' AND status='recovery_required')) ORDER BY send_at ASC LIMIT 100"
  ).all(userId, safeStatus, safeStatus);
}

// A synchronous immediate transaction serializes delivery against dissolution and
// other schedulers. There is no committed claim/commit gap for new deliveries.
async function sendDueMessages(io = null) {
  const now = Math.floor(Date.now() / 1000);
  // Old binaries used random message IDs, so an old sending row cannot prove
  // whether its message committed. Old overdue pending can also be a postcommit
  // retry from the old catch block. Expose both for reconciliation; never blind replay.
  db.prepare("UPDATE scheduled_messages SET delivery_version=1 WHERE status='pending' AND delivery_version=0 AND send_at>?").run(now);
  db.prepare("UPDATE scheduled_messages SET status='recovery_required' WHERE delivery_version=0 AND (status='sending' OR (status='pending' AND send_at<=?))").run(now);
  const dues = db.prepare("SELECT id FROM scheduled_messages WHERE status IN ('pending','sending') AND send_at<=? ORDER BY send_at,id LIMIT 50").all(now);
  let sent = 0;
  for (const { id } of dues) {
    let delivery;
    try {
      delivery = db.transaction(() => {
        const sched = db.prepare("SELECT * FROM scheduled_messages WHERE id=? AND status IN ('pending','sending')").get(id);
        if (!sched) return null;
        const msgId = `scheduled:${sched.id}`;
        const existing = db.prepare('SELECT id FROM messages WHERE id=?').get(msgId);
        if (existing) {
          db.prepare("UPDATE scheduled_messages SET status='sent',delivery_version=1 WHERE id=?").run(id);
          return null;
        }
        const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(sched.conversation_id,sched.sender_id);
        const conv = db.prepare('SELECT type,mute_all FROM conversations WHERE id=?').get(sched.conversation_id);
        const sender = db.prepare('SELECT banned FROM users WHERE id=?').get(sched.sender_id);
        if (!sender || sender.banned || !member || !conv || privateSendGuard(sched.conversation_id,sched.sender_id,conv) || (conv.mute_all && member.role==='member')) {
          db.prepare("UPDATE scheduled_messages SET status='cancelled' WHERE id=?").run(id);
          return null;
        }
        const sequence = appendConversationEventTx({
          conversationId:sched.conversation_id,eventType:'message_created',messageId:msgId,actorId:sched.sender_id,
          apply: seq => {
            db.prepare('INSERT INTO messages(id,conversation_id,sender_id,type,content,is_scheduled,server_sequence) VALUES (?,?,?,?,?,1,?)')
              .run(msgId,sched.conversation_id,sched.sender_id,sched.type,sched.content,seq);
            db.prepare("UPDATE scheduled_messages SET status='sent',delivery_version=1 WHERE id=?").run(id);
          },
        });
        return { sched, msgId, sequence };
      }).immediate();
    } catch (error) {
      console.error('[scheduled] transaction rolled back:', id, error.message);
      continue;
    }
    if (!delivery) continue;
    sent++;
    const { sched, msgId, sequence } = delivery;
    // Notification failure cannot change a durable sent result. Offline clients sync.
    try {
      const msg=buildMessage(msgId);
      cache.delPattern(`search:*${sched.sender_id}*`).catch(()=>{});
      convSvc.invalidateConvCacheForConversation(sched.conversation_id);
      broadcaster.broadcastMessage(sched.conversation_id,msg);
      emitSyncAvailable(io,sched.conversation_id,sequence);
      const sender=db.prepare('SELECT username FROM users WHERE id=?').get(sched.sender_id);
      await pushNewMessage({conversationId:sched.conversation_id,senderId:sched.sender_id,senderName:sender?.username||'',
        content:msg.burn_after ? '[阅后即焚消息]' : sched.content,type:sched.type,timestamp:msg.created_at,onlineUserIds:new Set()});
    } catch (error) { console.error('[scheduled] committed; notification failed:', id, error.message); }
  }
  return sent;
}

// ── 启动调度器（启动首扫 + 每 30s 定时，unref 不阻塞进程退出）──────
let _timer = null;
function startScheduler(io = null) {
  if (_timer) return _timer;
  sendDueMessages(io).catch(e => console.error('[scheduled] 启动扫描失败:', e.message));
  _timer = setInterval(() => {
    sendDueMessages(io).catch(e => console.error('[scheduled] 定时扫描失败:', e.message));
  }, 30 * 1000);
  _timer.unref?.();
  return _timer;
}

module.exports = {
  scheduleMessage, cancelScheduledMessage, listScheduledMessages,
  sendDueMessages, startScheduler, MIN_DELTA, MAX_DELTA,
};
