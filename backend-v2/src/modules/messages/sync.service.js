'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { writeSequencedEvent } = require('../../db/writer');
const { requireMember } = require('./shared');
const { badRequest } = require('../../utils/http');

const EVENT_TYPES = new Set([
  'message_created', 'message_edited', 'message_recalled',
  'message_deleted_for_me', 'message_vanished',
]);

async function appendConversationEvent({ conversationId, eventType, messageId, actorId, targetUserId = null, payload = {}, batchId = null, clientBatchId = null, ops = [] }) {
  if (!EVENT_TYPES.has(eventType)) throw new Error(`unsupported sync event: ${eventType}`);
  if (!conversationId || !messageId || !actorId) throw new Error('sync event identifiers required');
  return writeSequencedEvent({
    conversationId,
    event: {
      id: uuidv4(), eventType, messageId, actorId, targetUserId,
      batchId, clientBatchId,
      payload: JSON.stringify(payload || {}),
      createdAt: Math.floor(Date.now() / 1000),
    },
    ops,
  });
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

function syncConversation(conversationId, userId, query = {}) {
  requireMember(conversationId, userId);
  const cursor = parseNonNegativeInteger(query.cursor, 0);
  const requestedLimit = parseNonNegativeInteger(query.limit, 100);
  const limit = Math.min(Math.max(requestedLimit, 1), 500);
  const highWater = db.prepare('SELECT last_sequence FROM conversation_sequences WHERE conversation_id=?')
    .get(conversationId)?.last_sequence || 0;

  const rows = db.prepare(`
    SELECT e.*, m.id AS m_id, m.conversation_id AS m_conversation_id,
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
  `).all(conversationId, cursor, userId, limit + 1);

  const page = rows.slice(0, limit);
  const hasMoreVisible = rows.length > limit;
  const envelopes = page.map(row => {
    let payload = {};
    try { payload = JSON.parse(row.payload || '{}'); } catch {}
    let message = null;
    if (row.m_id && !['message_recalled', 'message_deleted_for_me', 'message_vanished'].includes(row.event_type)) {
      message = {
        id: row.m_id, conversation_id: row.m_conversation_id, sender_id: row.m_sender_id,
        type: row.m_type, content: row.m_content, file_url: row.m_file_url || '',
        reply_to_id: row.m_reply_to_id || null, deleted: row.m_deleted, created_at: row.m_created_at,
        edited: row.m_edited, duration: row.m_duration, client_msg_id: row.m_client_msg_id,
        is_scheduled: row.m_is_scheduled,
        file_mime: row.m_file_mime, file_size: row.m_file_size,
        server_sequence: row.m_server_sequence, senderName: row.senderName || '',
        senderAvatar: row.senderAvatar || '', reactions: [], replyTo: null,
      };
    }
    return {
      server_sequence: row.server_sequence, event_type: row.event_type,
      message_id: row.message_id, message, payload,
      batch_id: row.batch_id || null, client_batch_id: row.client_batch_id || null,
    };
  });

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
