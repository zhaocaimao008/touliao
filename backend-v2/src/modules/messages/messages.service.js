'use strict';
/**
 * 消息域 service。保留历史查询的批量化优化（N+1→2 query）与 FTS5 搜索。
 * P2 优化：集成 Redis 缓存
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { writeAsync, writeBatch } = require('../../db/writer');
const config = require('../../config');
const { badRequest, forbidden, notFound, conflict } = require('../../utils/http');
const { collectionDedupKey } = require('../../utils/collections');
const { isMember, requireMember, memberRole, buildMessage } = require('./shared');
const cache = require('../../utils/cache');
const broadcaster = require('../../realtime/broadcaster');

const MAX = config.limits.maxMsgLength;
const RECALL = config.limits.recallWindow;

// ── 历史消息（批量 replyTo + reactions，群已读数 / 私聊送达）──────
function history(convId, userId, { before, after, limit }) {
  requireMember(convId, userId);

  const rawLimit = parseInt(limit);
  const lim = (!isNaN(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 100) : 50;

  let query = `
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.conversation_id=? AND m.deleted=0
      AND m.created_at > COALESCE(
        (SELECT cleared_at FROM conversation_clears WHERE user_id=? AND conversation_id=m.conversation_id), 0
      )
  `;
  const params = [convId, userId];
  if (before) { query += ' AND m.created_at < ?'; params.push(Number(before)); }
  if (after)  { query += ' AND m.created_at > ?'; params.push(Number(after)); }
  query += after ? ' ORDER BY m.created_at ASC, m.rowid ASC LIMIT ?' : ' ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?';
  params.push(lim);

  const raw = db.prepare(query).all(...params);
  const messages = after ? raw : raw.reverse();

  const conv = db.prepare('SELECT type FROM conversations WHERE id=?').get(convId);

  let memberReadTimes = null;
  if (conv?.type === 'group') {
    memberReadTimes = db.prepare('SELECT cs.user_id, cs.last_read_at FROM conversation_settings cs WHERE cs.conversation_id=?').all(convId);
  }

  let deliverySet = new Set();
  if (conv?.type === 'private' && messages.length > 0) {
    const ids = messages.map(m => m.id);
    const ph = ids.map(() => '?').join(',');
    db.prepare(`SELECT message_id FROM message_deliveries WHERE message_id IN (${ph})`).all(...ids)
      .forEach(r => deliverySet.add(r.message_id));
  }

  // 批量 replyTo
  const replyIds = [...new Set(messages.filter(m => m.reply_to_id).map(m => m.reply_to_id))];
  const replyMap = new Map();
  if (replyIds.length > 0) {
    const ph = replyIds.map(() => '?').join(',');
    db.prepare(`
      SELECT m.id, m.type, m.content, m.file_url, u.username AS senderName
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id IN (${ph})
    `).all(...replyIds).forEach(r => replyMap.set(r.id, r));
  }

  // 批量 reactions
  const msgIds = messages.map(m => m.id);
  const reactionsMap = new Map();
  if (msgIds.length > 0) {
    const ph = msgIds.map(() => '?').join(',');
    db.prepare(`
      SELECT message_id, emoji, GROUP_CONCAT(user_id) AS userIds, COUNT(*) AS count
      FROM message_reactions WHERE message_id IN (${ph}) GROUP BY message_id, emoji
    `).all(...msgIds).forEach(r => {
      if (!reactionsMap.has(r.message_id)) reactionsMap.set(r.message_id, []);
      reactionsMap.get(r.message_id).push({ emoji: r.emoji, count: r.count, userIds: r.userIds.split(',') });
    });
  }

  return messages.map(msg => {
    msg.replyTo   = msg.reply_to_id ? (replyMap.get(msg.reply_to_id) || null) : null;
    msg.reactions = reactionsMap.get(msg.id) || [];
    if (conv?.type === 'private') msg._delivered = deliverySet.has(msg.id);
    if (memberReadTimes && conv?.type === 'group') {
      msg.readCount = memberReadTimes.filter(m => m.user_id !== msg.sender_id && m.last_read_at >= msg.created_at).length;
    }
    return msg;
  });
}

// ── 断线补拉（io 用于送达回执）──────────────────────────────────
function missed(io, userId, after) {
  if (after <= 0) throw badRequest('after 参数无效');
  const convRows = db.prepare('SELECT conversation_id FROM conversation_members WHERE user_id=?').all(userId);
  if (!convRows.length) return [];

  const convIds = convRows.map(r => r.conversation_id);
  const ph = convIds.map(() => '?').join(',');
  const messages = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id IN (${ph}) AND m.deleted = 0 AND m.created_at > ?
    ORDER BY m.created_at ASC LIMIT 300
  `).all(...convIds, after);

  const replyIds = [...new Set(messages.filter(m => m.reply_to_id).map(m => m.reply_to_id))];
  const replyMap = new Map();
  if (replyIds.length > 0) {
    const rph = replyIds.map(() => '?').join(',');
    db.prepare(`
      SELECT m.id, m.type, m.content, m.file_url, u.username AS senderName
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id IN (${rph})
    `).all(...replyIds).forEach(r => replyMap.set(r.id, r));
  }

  // 批量 reactions (fix missed() reactions bug)
  const msgIds = messages.map(m => m.id).filter(Boolean);
  const reactionsMap = new Map();
  if (msgIds.length > 0) {
    const rph = msgIds.map(() => '?').join(',');
    db.prepare(`
      SELECT message_id, emoji, COUNT(*) as count,
             group_concat(user_id) as userIds
      FROM message_reactions WHERE message_id IN (${rph})
      GROUP BY message_id, emoji
    `).all(...msgIds).forEach(r => {
      if (!reactionsMap.has(r.message_id)) reactionsMap.set(r.message_id, []);
      reactionsMap.get(r.message_id).push({ emoji: r.emoji, count: r.count, userIds: r.userIds.split(',') });
    });
  }

  const enriched = messages.map(msg => {
    msg.replyTo = msg.reply_to_id ? (replyMap.get(msg.reply_to_id) || null) : null;
    msg.reactions = reactionsMap.get(msg.id) || [];
    return msg;
  });

  if (enriched.length > 0) {
    const insertDelivery = db.prepare('INSERT OR IGNORE INTO message_deliveries (message_id, user_id) VALUES (?, ?)');
    db.transaction(() => {
      enriched.forEach(msg => { if (msg.sender_id !== userId) insertDelivery.run(msg.id, userId); });
    })();

    if (io) {
      const bySender = {};
      enriched.forEach(msg => {
        if (msg.sender_id === userId) return;
        (bySender[msg.sender_id] ||= []).push({ messageId: msg.id, conversationId: msg.conversation_id });
      });
      Object.entries(bySender).forEach(([senderId, items]) => {
        io.to(`user_${senderId}`).emit('message_delivered', { deliveredTo: userId, messages: items });
      });
    }
  }
  return enriched;
}

// ── HTTP 发送（fallback）────────────────────────────────────────
async function send(io, convId, userId, { content, type, reply_to_id }) {
  const ALLOWED_HTTP_TYPES = new Set(['text', 'contact_card']);
  const safeType = ALLOWED_HTTP_TYPES.has(type) ? type : 'text';
  if (!content) throw badRequest('消息不能为空');
  if (typeof content === 'string' && content.length > MAX) throw badRequest(`消息内容不能超过 ${MAX} 个字符`);
  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, userId);
  if (!member) throw forbidden('无权发送');
  const conv = db.prepare('SELECT mute_all, type FROM conversations WHERE id=?').get(convId);
  // 屏蔽陌生人消息：私聊会话中，若对方开启了该设置且双方互不是联系人，则拒绝发送
  if (conv?.type === 'private') {
    const recipient = db.prepare(
      'SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id!=?'
    ).get(convId, userId);
    if (recipient) {
      const setting = db.prepare(
        "SELECT block_unknown_messages FROM user_settings WHERE user_id=?"
      ).get(recipient.user_id);
      if (setting?.block_unknown_messages) {
        const isFriend = db.prepare(
          'SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?'
        ).get(recipient.user_id, userId);
        if (!isFriend) throw forbidden('对方已开启屏蔽陌生人消息');
      }
    }
  }
  if (conv?.mute_all && member.role === 'member') throw forbidden('全员禁言中，您没有发言权限');
  const id = uuidv4();
  // P0-1：改走 worker 异步写，主线程不再同步抢 WAL 写锁；await 保证落库后再 buildMessage 读回
  await writeAsync(
    'INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id) VALUES (?,?,?,?,?,?)',
    [id, convId, userId, safeType, content, reply_to_id || null]
  );

  // #4 尾延迟：缓存失效是非关键写，改后台异步执行，不阻塞响应
  cache.delPattern(`search:*${userId}*`).catch(() => {});
  cache.del(cache.keys.conversations(userId)).catch(() => {});

  const msg = buildMessage(id);
  broadcaster.broadcastMessage(convId, msg);
  return msg;
}

// ── 文件消息（本地上传后入库 + 广播）───────────────────────────
async function saveUploadedFile(io, convId, userId, { type, content, fileUrl, reply_to_id }) {
  const id = uuidv4();
  // P0-1：worker 异步写，await 落库后再读回构建消息
  await writeAsync(
    'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,reply_to_id) VALUES (?,?,?,?,?,?,?)',
    [id, convId, userId, type, content, fileUrl, reply_to_id || null]
  );
  const msg = buildMessage(id);
  broadcaster.broadcastMessage(convId, msg);
  return msg;
}

// ── 转发 ────────────────────────────────────────────────────────
async function forward(io, userId, { msgId, conversationIds }) {
  if (!msgId || !conversationIds?.length) throw badRequest('参数缺失');
  const msg = db.prepare('SELECT * FROM messages WHERE id=? AND deleted=0').get(msgId);
  if (!msg) throw notFound('消息不存在');
  requireMember(msg.conversation_id, userId, '无权转发该消息');

  const insertSql = 'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,duration) VALUES (?,?,?,?,?,?,?)';
  const ops = [];
  const targets = [];   // { convId, id }
  conversationIds.forEach(convId => {
    if (!isMember(convId, userId)) return;
    const id = uuidv4();
    ops.push({ sql: insertSql, params: [id, convId, userId, msg.type, msg.content, msg.file_url || '', msg.duration || 0] });
    targets.push({ convId, id });
  });

  // P0-1：原子批次走 worker（保持"多条转发要么全成功要么全失败"语义），await 落库后再读回广播
  if (ops.length) await writeBatch(ops);

  const selectStmt = db.prepare('SELECT m.*, u.username as senderName, u.avatar as senderAvatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?');
  targets.forEach(({ convId, id }) => {
    const newMsg = selectStmt.get(id);
    if (!newMsg) return;
    newMsg.reactions = [];
    broadcaster.broadcastMessage(convId, newMsg);
  });
  return targets.length;
}

// ── 批量撤回 ────────────────────────────────────────────────────
async function batchDelete(io, userId, { msgIds, conversationId }) {
  if (!msgIds?.length || !conversationId) throw badRequest('参数缺失');
  if (msgIds.length > 20) throw badRequest('单次最多批量撤回 20 条');
  const role = memberRole(conversationId, userId);
  if (!role) throw forbidden('不在会话中');

  const isAdmin = role === 'owner' || role === 'admin';
  const now = Math.floor(Date.now() / 1000);
  const ops = [];
  const deleted = [];
  // 批量查询代替 N 次单独 SELECT
  const ph2 = msgIds.map(() => '?').join(',');
  const msgs = db.prepare(`SELECT * FROM messages WHERE id IN (${ph2}) AND conversation_id=? AND deleted=0`).all(...msgIds, conversationId);
  msgs.forEach(msg => {
    const isOwn = msg.sender_id === userId;
    const inTime = (now - msg.created_at) <= RECALL;
    if ((isOwn && inTime) || isAdmin) {
      ops.push({ sql: 'UPDATE messages SET deleted=1 WHERE id=?', params: [msg.id] });
      deleted.push(msg.id);
    }
  });
  // P0-1：原子批次走 worker，落库后再广播
  if (ops.length) await writeBatch(ops);
  // 批量 emit（单次事件，减少前端重渲染次数）
  if (io && deleted.length > 0) io.to(conversationId).emit('messages_batch_deleted', { msgIds: deleted, conversationId });
  return deleted.length;
}

// ── 单条撤回 ────────────────────────────────────────────────────
async function remove(io, userId, msgId, forEveryone) {
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
  if (!msg) throw notFound('消息不存在');
  if (forEveryone) {
    const isOwn = msg.sender_id === userId;
    const callerRole = memberRole(msg.conversation_id, userId);
    const isAdmin = callerRole === 'owner' || callerRole === 'admin';
    if (!isOwn && !isAdmin) throw forbidden('无权删除该消息');
    if (isOwn && Math.floor(Date.now() / 1000) - msg.created_at > RECALL) throw badRequest('超过2分钟无法撤回');
    // P0-1：worker 异步写，await 落库后再广播
    await writeAsync('UPDATE messages SET deleted=1 WHERE id=?', [msgId]);
    if (io) io.to(msg.conversation_id).emit('message_deleted', { msgId, conversationId: msg.conversation_id });
  }
  // 仅自己隐藏：前端处理，不改库
}

// ── 表情回应（toggle）────────────────────────────────────────────
async function react(io, userId, msgId, emoji) {
  if (!emoji) throw badRequest('参数缺失');
  if (typeof emoji !== 'string' || emoji.length > 10) throw badRequest('emoji 格式不正确');
  const msg = db.prepare('SELECT conversation_id FROM messages WHERE id=?').get(msgId);
  if (!msg) throw notFound('消息不存在');
  requireMember(msg.conversation_id, userId, '无权操作');  // 防越权：非会话成员不得贴表情

  const existing = db.prepare('SELECT * FROM message_reactions WHERE message_id=? AND user_id=?').get(msgId, userId);
  // P0-1：worker 异步写，await 落库后再聚合读回（读后写一致）
  if (existing && existing.emoji === emoji) {
    await writeAsync('DELETE FROM message_reactions WHERE message_id=? AND user_id=?', [msgId, userId]);
  } else {
    await writeAsync('INSERT OR REPLACE INTO message_reactions (message_id,user_id,emoji) VALUES (?,?,?)', [msgId, userId, emoji]);
  }
  const result = db.prepare(`
    SELECT emoji, GROUP_CONCAT(user_id) as userIds, COUNT(*) as count
    FROM message_reactions WHERE message_id=? GROUP BY emoji
  `).all(msgId).map(r => ({ emoji: r.emoji, count: r.count, userIds: r.userIds.split(',') }));
  if (io) io.to(msg.conversation_id).emit('message_reaction', { msgId, reactions: result });
  return result;
}

// ── 编辑 ────────────────────────────────────────────────────────
async function edit(io, userId, msgId, content) {
  if (!content?.trim()) throw badRequest('内容不能为空');
  if (content.trim().length > MAX) throw badRequest(`消息内容不能超过 ${MAX} 个字符`);
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
  if (!msg) throw notFound('消息不存在');
  if (msg.sender_id !== userId) throw forbidden('只能编辑自己的消息');
  if (msg.type !== 'text') throw badRequest('只能编辑文字消息');
  if (msg.deleted) throw badRequest('已撤回的消息无法编辑');
  if (Math.floor(Date.now() / 1000) - msg.created_at > RECALL) throw badRequest('超过2分钟无法编辑');

  const trimmed = content.trim();
  // P0-1：worker 异步写，await 落库后再广播
  await writeAsync('UPDATE messages SET content=?, edited=1 WHERE id=?', [trimmed, msgId]);
  if (io) io.to(msg.conversation_id).emit('message_edited', { msgId, content: trimmed, conversationId: msg.conversation_id });
  return trimmed;
}

// ── 收藏 ────────────────────────────────────────────────────────
async function collect(userId, msgId) {
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
  if (!msg) throw notFound('消息不存在');
  requireMember(msg.conversation_id, userId, '无权操作');
  const extra = { file_url: msg.file_url, source_msg_id: msg.id };
  const dedupKey = collectionDedupKey(msg.type, msg.content, extra);
  // 去重：同一内容已收藏则 409（唯一索引兜底竞态，避免重复行）
  const existing = db.prepare('SELECT id FROM collections WHERE user_id=? AND dedup_key=?').get(userId, dedupKey);
  if (existing) throw conflict('已收藏', 'COLLECTION_DUPLICATE');
  // P0-1：worker 异步写
  const id = uuidv4();
  await writeAsync('INSERT INTO collections (id,user_id,type,content,extra,dedup_key) VALUES (?,?,?,?,?,?)',
    [id, userId, msg.type, msg.content, JSON.stringify(extra), dedupKey]
  );
  // CO3：回传新建的收藏对象
  const row = db.prepare('SELECT * FROM collections WHERE id=?').get(id);
  return row ? { ...row, extra: JSON.parse(row.extra || '{}') } : { id };
}

// ── 全局搜索（FTS5 trigram 全文索引 + 成员范围限定）──────────────
async function searchGlobal(userId, { q, limit = 20, offset = 0 }) {
  if (!q || !q.trim()) return { results: [], total: 0 };
  if (q.length > 100) throw badRequest('搜索词过长');

  const safeLimit = Math.min(parseInt(limit) || 20, 50);
  const safeOffset = Math.min(Math.max(parseInt(offset) || 0, 0), 10000);

  const cacheKey = `search:${userId}:${q}:${safeLimit}:${safeOffset}`;
  const cachedResult = await cache.get(cacheKey);
  if (cachedResult) return cachedResult;

  // FTS5 phrase query: double-quote wrap 防止特殊字符被解析为 FTS5 语法
  const ftsQuery = '"' + q.trim().replace(/"/g, '""') + '"';

  const total = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.message_id AND m.deleted = 0
    JOIN conversation_members cm ON cm.conversation_id = messages_fts.conversation_id AND cm.user_id = ?
    WHERE messages_fts MATCH ?
  `).get(userId, ftsQuery)?.cnt || 0;

  const rows = db.prepare(`
    SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at,
           u.username AS senderName, u.avatar AS senderAvatar,
           c.name AS convName, c.type AS convType,
           ou.id AS ou_id, ou.username AS ou_username, ou.avatar AS ou_avatar, ou.status AS ou_status
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.message_id AND m.deleted = 0
    JOIN conversation_members cm ON cm.conversation_id = messages_fts.conversation_id AND cm.user_id = ?
    JOIN users u ON u.id = m.sender_id
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN conversation_members cm_o
           ON cm_o.conversation_id = m.conversation_id AND cm_o.user_id != ? AND c.type = 'private'
    LEFT JOIN users ou ON ou.id = cm_o.user_id
    WHERE messages_fts MATCH ?
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).all(userId, userId, ftsQuery, safeLimit, safeOffset);

  const results = rows.map(({ ou_id, ou_username, ou_avatar, ou_status, ...msg }) => {
    if (msg.convType === 'private') {
      msg.convName = ou_username || '私聊';
      msg.otherUser = ou_id ? { id: ou_id, username: ou_username, avatar: ou_avatar, status: ou_status } : null;
    }
    return msg;
  });

  const result = { results, total, limit: safeLimit, offset: safeOffset };
  await cache.set(cacheKey, result, 600);
  return result;
}

// ── 会话内搜索 ──────────────────────────────────────────────────
async function searchInConversation(convId, userId, q) {
  if (!q) return [];
  if (q.length > 100) throw badRequest('搜索词过长');
  requireMember(convId, userId);

  // P2 优化：尝试从缓存获取搜索结果（TTL: 10 分钟）
  const cacheKey = `search:${convId}:${userId}:${q}`;
  let cachedResult = await cache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  const escapedQ = q.replace(/[%_\\]/g, '\\$&');
  const searchTerm = `%${escapedQ}%`;
  const result = db.prepare(`
    SELECT m.*, u.username AS senderName, u.avatar AS senderAvatar
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? AND m.deleted = 0 AND m.content LIKE ? ESCAPE '\\'
    ORDER BY m.created_at DESC LIMIT 30
  `).all(convId, searchTerm);

  // 写入缓存（TTL: 10 分钟）
  await cache.set(cacheKey, result, 600);

  return result;
}

module.exports = {
  history, missed, send, saveUploadedFile, forward, batchDelete,
  remove, react, edit, collect, searchGlobal, searchInConversation,
};
