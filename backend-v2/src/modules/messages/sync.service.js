'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { writeSequencedEvent } = require('../../db/writer');
const { requireMember } = require('./shared');
const { badRequest } = require('../../utils/http');

const EVENT_TYPES = new Set([
  'message_created', 'message_edited', 'message_recalled',
  'message_deleted_for_me', 'message_vanished', 'conversation_cleared', 'message_burn_started',
]);

async function appendConversationEvent({ conversationId, eventType, messageId, actorId, targetUserId = null, payload = {}, batchId = null, clientBatchId = null, ops = [] }) {
  if (!EVENT_TYPES.has(eventType)) throw new Error(`unsupported sync event: ${eventType}`);
  if (!conversationId || !messageId || !actorId) throw new Error('sync event identifiers required');
  const result = await writeSequencedEvent({
    conversationId,
    event: {
      id: uuidv4(), eventType, messageId, actorId, targetUserId,
      batchId, clientBatchId,
      payload: JSON.stringify(payload || {}),
      createdAt: Math.floor(Date.now() / 1000),
    },
    ops,
  });
  // 所有消息类变更（发送/撤回/编辑/系统提示…）都经此落库：提交后失效全体成员的会话列表缓存。
  // 否则对方收到 new_message 等事件后立刻重拉列表，会拿到 2s 缓存里的旧预览/旧未读并一直停在那里。
  // 懒加载：conversations.service 依赖 messages 模块，避免加载期循环依赖。
  require('../conversations/conversations.service').invalidateConvCacheForConversation(conversationId);
  return result;
}

/** 供必须保持同步事务的资金路径调用；调用方必须已处于 db.transaction 内。 */
function appendConversationEventTx({ conversationId, eventType, messageId, actorId, targetUserId = null, payload = {}, batchId = null, clientBatchId = null, apply }) {
  if (!EVENT_TYPES.has(eventType)) throw new Error(`unsupported sync event: ${eventType}`);
  const row = db.prepare(`
    INSERT INTO conversation_sequences (conversation_id,last_sequence) VALUES (?,1)
    ON CONFLICT(conversation_id) DO UPDATE SET last_sequence=last_sequence+1
    RETURNING last_sequence
  `).get(conversationId);
  const sequence = row.last_sequence;
  apply(sequence);
  db.prepare(`INSERT INTO conversation_events
    (id,conversation_id,server_sequence,event_type,message_id,actor_id,target_user_id,payload,created_at,batch_id,client_batch_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    uuidv4(), conversationId, sequence, eventType, messageId, actorId, targetUserId,
    JSON.stringify(payload || {}), Math.floor(Date.now() / 1000), batchId, clientBatchId
  );
  return sequence;
}

function parseNonNegativeInteger(value, fallback) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw badRequest('cursor 参数无效');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw badRequest('cursor 参数无效');
  return n;
}

function syncConversation(conversationId, userId, query = {}, io=null) {
  requireMember(conversationId, userId);
  require('./burn.service').expireDueMessages();
  const cursor = parseNonNegativeInteger(query.cursor, 0);
  const requestedLimit = parseNonNegativeInteger(query.limit, 100);
  const limit = Math.min(Math.max(requestedLimit, 1), 500);
  const highWater = db.prepare('SELECT last_sequence FROM conversation_sequences WHERE conversation_id=?')
    .get(conversationId)?.last_sequence || 0;

  const rows = db.prepare(`
    SELECT e.*, m.rowid AS m_rowid,
           COALESCE((SELECT cleared_rowid FROM conversation_clears WHERE conversation_id=e.conversation_id AND user_id=?),0) AS cleared_rowid,
           EXISTS(SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?) AS personally_deleted,
           m.burn_after, m.burn_read_at, m.burn_expires_at, m.id AS m_id, m.conversation_id AS m_conversation_id,
           m.sender_id AS m_sender_id, m.type AS m_type, m.content AS m_content,
           m.file_url AS m_file_url, m.reply_to_id AS m_reply_to_id,
           m.deleted AS m_deleted, m.created_at AS m_created_at, m.edited AS m_edited,
           m.duration AS m_duration, m.client_msg_id AS m_client_msg_id,
           m.is_scheduled AS m_is_scheduled,
           m.file_mime AS m_file_mime, m.file_size AS m_file_size,
           m.server_sequence AS m_server_sequence,
           u.username AS senderName, u.avatar AS senderAvatar
    FROM conversation_events e
    LEFT JOIN messages m ON m.id=e.message_id
    LEFT JOIN users u ON u.id=m.sender_id
    WHERE e.conversation_id=? AND e.server_sequence>?
      AND (e.target_user_id IS NULL OR e.target_user_id=?)
    ORDER BY e.server_sequence ASC
    LIMIT ?
  `).all(userId, userId, conversationId, cursor, userId, limit + 1);

  const page = rows.slice(0, limit);
  const hasMoreVisible = rows.length > limit;
  const envelopes = page.map(row => {
    let payload = {};
    try { payload = JSON.parse(row.payload || '{}'); } catch {}
    const hidden = row.personally_deleted || (row.m_rowid != null && row.m_rowid <= row.cleared_rowid);
    if (hidden || row.m_deleted === 2) payload = {};
    let message = null;
    if (row.m_id && !['message_recalled', 'message_deleted_for_me', 'message_vanished'].includes(row.event_type)) {
      message = {
        id: row.m_id, conversation_id: row.m_conversation_id, sender_id: row.m_sender_id,
        type: row.m_type, content: hidden ? '' : row.m_content, file_url: hidden ? '' : row.m_file_url || '',
        reply_to_id: row.m_reply_to_id || null, deleted: hidden ? 2 : row.m_deleted, created_at: row.m_created_at,
        edited: row.m_edited, duration: row.m_duration, client_msg_id: row.m_client_msg_id,
        is_scheduled: row.m_is_scheduled, burn_after: row.burn_after, burn_read_at: row.burn_read_at, burn_expires_at: row.burn_expires_at,
        file_mime: row.m_file_mime, file_size: row.m_file_size,
        server_sequence: row.m_server_sequence, senderName: row.senderName || '',
        senderAvatar: row.senderAvatar || '', reactions: [], replyTo: null,
      };
    }
    return {
      server_sequence: row.server_sequence, event_type: row.event_type,
      message_id: row.message_id, message, payload: hidden ? {} : payload,
      batch_id: row.batch_id || null, client_batch_id: row.client_batch_id || null,
    };
  });

  // 与 history 同口径补全引用块与表情回应：原先写死 replyTo:null / reactions:[]，客户端用同步结果
  // 覆盖实时消息后，回复丢失引用块、带表情的消息表情消失（离线补拉的消息同样如此）。
  const synced = envelopes.map(e => e.message).filter(m => m && m.deleted !== 2);
  require('./shared').applyGroupNicknames(conversationId, synced);
  const replyIds = [...new Set(synced.filter(m => m.reply_to_id).map(m => m.reply_to_id))];
  if (replyIds.length) {
    const ph = replyIds.map(() => '?').join(',');
    const replyMap = new Map(db.prepare(`
      SELECT m.id, m.type, CASE WHEN m.burn_after>0 THEN '' ELSE m.content END AS content, CASE WHEN m.burn_after>0 THEN '' ELSE m.file_url END AS file_url, m.deleted, COALESCE(u.username, '') AS senderName
      FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id IN (${ph}) AND m.conversation_id = ?
    `).all(...replyIds, conversationId).map(r => [r.id, r]));
    for (const m of synced) if (m.reply_to_id) m.replyTo = replyMap.get(m.reply_to_id) || null;
  }
  if (synced.length) {
    const ph = synced.map(() => '?').join(',');
    const reactionsMap = new Map();
    db.prepare(`
      SELECT message_id, emoji, GROUP_CONCAT(user_id) AS userIds, COUNT(*) AS count
      FROM message_reactions WHERE message_id IN (${ph}) GROUP BY message_id, emoji
    `).all(...synced.map(m => m.id)).forEach(r => {
      if (!reactionsMap.has(r.message_id)) reactionsMap.set(r.message_id, []);
      reactionsMap.get(r.message_id).push({ emoji: r.emoji, count: r.count, userIds: r.userIds.split(',') });
    });
    for (const m of synced) m.reactions = reactionsMap.get(m.id) || [];
  }

  require('./burn.service').recordDelivery(userId,envelopes.map(e=>e.message).filter(Boolean),io);

  let nextCursor;
  let hasMore;
  if (hasMoreVisible) {
    nextCursor = envelopes[envelopes.length - 1].server_sequence;
    hasMore = true;
  } else {
    nextCursor = highWater;
    hasMore = false;
  }
  return { next_cursor: Math.max(cursor, nextCursor), has_more: hasMore, messages: envelopes };
}

function emitSyncAvailable(io, conversationId, serverSequence) {
  if (io && serverSequence != null) {
    io.to(conversationId).emit('conversation_sync_available', {
      conversationId, server_sequence: serverSequence,
    });
  }
}

module.exports = { EVENT_TYPES, appendConversationEvent, appendConversationEventTx, syncConversation, emitSyncAvailable };
