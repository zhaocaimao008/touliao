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
const { isMember, requireMember, memberRole, buildMessage, privateSendBlockReason, strangerBlockReason } = require('./shared');
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
  // 游标须为有限数值才生效；非法值（NaN/空串）忽略，回退为「最近 N 条」，
  // 否则 created_at < NaN 恒假会把历史吞空。排序方向也依据校验后的 after。
  const beforeTs = Number(before);
  const afterTs = Number(after);
  const hasBefore = before != null && before !== '' && Number.isFinite(beforeTs);
  const hasAfter  = after  != null && after  !== '' && Number.isFinite(afterTs);
  if (hasBefore) { query += ' AND m.created_at < ?'; params.push(beforeTs); }
  if (hasAfter)  { query += ' AND m.created_at > ?'; params.push(afterTs); }
  query += hasAfter ? ' ORDER BY m.created_at ASC, m.rowid ASC LIMIT ?' : ' ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?';
  params.push(lim);

  const raw = db.prepare(query).all(...params);
  const messages = hasAfter ? raw : raw.reverse();

  const conv = db.prepare('SELECT type FROM conversations WHERE id=?').get(convId);

  let memberReadTimes = null;
  if (conv?.type === 'group') {
    memberReadTimes = db.prepare('SELECT cs.user_id, cs.last_read_at FROM conversation_settings cs WHERE cs.conversation_id=?').all(convId);
  }

  let deliverySet = new Set();
  let peerLastReadAt = 0;
  if (conv?.type === 'private' && messages.length > 0) {
    const ids = messages.map(m => m.id);
    const ph = ids.map(() => '?').join(',');
    db.prepare(`SELECT message_id FROM message_deliveries WHERE message_id IN (${ph})`).all(...ids)
      .forEach(r => deliverySet.add(r.message_id));
    const peerRow = db.prepare(
      'SELECT last_read_at FROM conversation_settings WHERE conversation_id=? AND user_id!=? LIMIT 1'
    ).get(convId, userId);
    peerLastReadAt = peerRow?.last_read_at || 0;
  }

  // 批量 replyTo
  const replyIds = [...new Set(messages.filter(m => m.reply_to_id).map(m => m.reply_to_id))];
  const replyMap = new Map();
  if (replyIds.length > 0) {
    const ph = replyIds.map(() => '?').join(',');
    db.prepare(`
      SELECT m.id, m.type, m.content, m.file_url, m.deleted, u.username AS senderName
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id IN (${ph}) AND m.conversation_id = ?
    `).all(...replyIds, convId).forEach(r => replyMap.set(r.id, r));
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
    if (conv?.type === 'private') {
      msg._delivered = deliverySet.has(msg.id);
      if (msg.sender_id === userId && peerLastReadAt > 0) msg._read = msg.created_at <= peerLastReadAt;
    }
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
    const convPh = convIds.map(() => '?').join(',');
    db.prepare(`
      SELECT m.id, m.type, m.content, m.file_url, m.deleted, u.username AS senderName
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id IN (${rph}) AND m.conversation_id IN (${convPh})
    `).all(...replyIds, ...convIds).forEach(r => replyMap.set(r.id, r));
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
  if (!content || typeof content !== 'string') throw badRequest('消息内容格式错误');
  if (content.length > MAX) throw badRequest(`消息内容不能超过 ${MAX} 个字符`);
  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, userId);
  if (!member) throw forbidden('无权发送');
  const conv = db.prepare('SELECT mute_all, type FROM conversations WHERE id=?').get(convId);
  // 黑名单：任一方拉黑对方即拒绝私聊发消息（防止拉黑后经既有会话继续骚扰）
  const blockReason = privateSendBlockReason(convId, userId);
  if (blockReason) throw forbidden(blockReason);
  // 屏蔽陌生人消息：私聊会话中，若对方开启该设置且发送者不在其联系人中，则拒绝发送
  const strangerReason = strangerBlockReason(convId, userId);
  if (strangerReason) throw forbidden(strangerReason);
  if (conv?.mute_all && member.role === 'member') throw forbidden('全员禁言中，您没有发言权限');
  if (reply_to_id) {
    const ref = db.prepare('SELECT id FROM messages WHERE id=? AND conversation_id=?').get(reply_to_id, convId);
    if (!ref) throw badRequest('被回复消息不存在');
  }
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
  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, userId);
  if (!member) throw forbidden('无权发送');
  const conv = db.prepare('SELECT mute_all FROM conversations WHERE id=?').get(convId);
  if (conv?.mute_all && member.role === 'member') throw forbidden('全员禁言中，您没有发言权限');
  // 黑名单：任一方拉黑对方即拒绝私聊发文件（与文本发送一致）
  const blockReason = privateSendBlockReason(convId, userId);
  if (blockReason) throw forbidden(blockReason);
  // 屏蔽陌生人消息：与文本发送一致，防止陌生人用文件/图片/表情绕过该设置骚扰
  const strangerReason = strangerBlockReason(convId, userId);
  if (strangerReason) throw forbidden(strangerReason);
  if (reply_to_id) {
    const ref = db.prepare('SELECT id FROM messages WHERE id=? AND conversation_id=?').get(reply_to_id, convId);
    if (!ref) throw badRequest('被回复消息不存在');
  }
  const id = uuidv4();
  // P0-1：worker 异步写，await 落库后再读回构建消息
  await writeAsync(
    'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,reply_to_id) VALUES (?,?,?,?,?,?,?)',
    [id, convId, userId, type, content, fileUrl, reply_to_id || null]
  );
  cache.delPattern(`search:*${userId}*`).catch(() => {});
  cache.del(cache.keys.conversations(userId)).catch(() => {});
  const msg = buildMessage(id);
  broadcaster.broadcastMessage(convId, msg);
  return msg;
}

// ── 转发 ────────────────────────────────────────────────────────
async function forward(io, userId, { msgId, conversationIds }) {
  if (!msgId || !conversationIds?.length) throw badRequest('参数缺失');
  if (conversationIds.length > 20) throw badRequest('单次转发最多20个会话');
  const FORWARDABLE_TYPES = new Set(['text', 'image', 'voice', 'video', 'file', 'contact_card']);
  const msg = db.prepare('SELECT * FROM messages WHERE id=? AND deleted=0').get(msgId);
  if (!msg) throw notFound('消息不存在');
  if (!FORWARDABLE_TYPES.has(msg.type)) throw badRequest('该类型消息不支持转发');
  requireMember(msg.conversation_id, userId, '无权转发该消息');

  const insertSql = 'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,duration) VALUES (?,?,?,?,?,?,?)';
  const ops = [];
  const targets = [];   // { convId, id }
  // 批量查询一次，避免 N+1
  const placeholders = conversationIds.map(() => '?').join(',');
  const memberConvIds = new Set(
    db.prepare(`SELECT conversation_id FROM conversation_members WHERE user_id=? AND conversation_id IN (${placeholders})`)
      .all(userId, ...conversationIds).map(r => r.conversation_id)
  );
  // 批量查询目标会话 mute_all + 成员 role，防止普通成员绕过全员禁言
  const muteMap = new Map(
    db.prepare(`SELECT id, mute_all FROM conversations WHERE id IN (${placeholders})`).all(...conversationIds).map(r => [r.id, r.mute_all])
  );
  const roleMap = new Map(
    db.prepare(`SELECT conversation_id, role FROM conversation_members WHERE user_id=? AND conversation_id IN (${placeholders})`).all(userId, ...conversationIds).map(r => [r.conversation_id, r.role])
  );
  conversationIds.forEach(convId => {
    if (!memberConvIds.has(convId)) return;
    if (muteMap.get(convId) && roleMap.get(convId) === 'member') return;
    // 黑名单私聊：静默跳过被拉黑/已拉黑的目标（不计入成功转发数）
    if (privateSendBlockReason(convId, userId)) return;
    // 屏蔽陌生人：静默跳过"对方开启屏蔽陌生人且我非其好友"的私聊目标，防止用转发绕过
    if (strangerBlockReason(convId, userId)) return;
    const id = uuidv4();
    ops.push({ sql: insertSql, params: [id, convId, userId, msg.type, msg.content, msg.file_url || '', msg.duration || 0] });
    targets.push({ convId, id });
  });

  // P0-1：原子批次走 worker（保持"多条转发要么全成功要么全失败"语义），await 落库后再读回广播
  if (ops.length) await writeBatch(ops);
  if (ops.length) {
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    cache.del(cache.keys.conversations(userId)).catch(() => {});
  }

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
    if (isOwn || isAdmin) {
      ops.push({ sql: 'UPDATE messages SET deleted=1 WHERE id=?', params: [msg.id] });
      deleted.push(msg.id);
    }
  });
  // P0-1：原子批次走 worker，落库后再广播
  if (ops.length) await writeBatch(ops);
  if (ops.length) {
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    cache.del(cache.keys.conversations(userId)).catch(() => {});
  }
  // 批量 emit（单次事件，减少前端重渲染次数）
  if (io && deleted.length > 0) io.to(conversationId).emit('messages_batch_deleted', { msgIds: deleted, conversationId });
  return deleted.length;
}

// ── 单条撤回 ────────────────────────────────────────────────────
async function remove(io, userId, msgId, forEveryone, vanish) {
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
  if (!msg) throw notFound('消息不存在');

  if (vanish) {
    // 彻底删除不留痕迹：内容清空，deleted=2，对方也不见任何提示
    const callerRole = memberRole(msg.conversation_id, userId);
    if (!callerRole) throw forbidden('您已不在该会话中');
    const isAdmin = callerRole === 'owner' || callerRole === 'admin';
    if (msg.sender_id !== userId && !isAdmin) throw forbidden('无权删除该消息');
    await writeAsync("UPDATE messages SET deleted=2, content='', file_url='' WHERE id=?", [msgId]);
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    cache.del(cache.keys.conversations(userId)).catch(() => {});
    if (io) io.to(msg.conversation_id).emit('message_vanished', { msgId, conversationId: msg.conversation_id });
    return;
  }

  if (forEveryone) {
    const isOwn = msg.sender_id === userId;
    const callerRole = memberRole(msg.conversation_id, userId);
    if (!callerRole) throw forbidden('您已不在该会话中');
    const isAdmin = callerRole === 'owner' || callerRole === 'admin';
    if (!isOwn && !isAdmin) throw forbidden('无权删除该消息');
    if (msg.deleted === 2) throw badRequest('消息已彻底删除，无法再次操作');
    if (isOwn && !isAdmin && Math.floor(Date.now() / 1000) - msg.created_at > RECALL)
      throw badRequest('超过2分钟无法撤回');
    await writeAsync('UPDATE messages SET deleted=1 WHERE id=?', [msgId]);
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    cache.del(cache.keys.conversations(userId)).catch(() => {});
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

  // 读-判断-写在事务内原子执行，防止快速双击 toggle 时的竞态
  db.transaction(() => {
    const existing = db.prepare('SELECT emoji FROM message_reactions WHERE message_id=? AND user_id=?').get(msgId, userId);
    if (existing && existing.emoji === emoji) {
      db.prepare('DELETE FROM message_reactions WHERE message_id=? AND user_id=?').run(msgId, userId);
    } else {
      db.prepare('INSERT OR REPLACE INTO message_reactions (message_id,user_id,emoji) VALUES (?,?,?)').run(msgId, userId, emoji);
    }
  })();
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
  requireMember(msg.conversation_id, userId, '您已不在该会话中，无法编辑消息');
  if (msg.type !== 'text') throw badRequest('只能编辑文字消息');
  if (msg.deleted) throw badRequest('已撤回的消息无法编辑');
  if (Math.floor(Date.now() / 1000) - msg.created_at > RECALL) throw badRequest('超过2分钟无法编辑');

  const trimmed = content.trim();
  // P0-1：worker 异步写，await 落库后再广播
  await writeAsync('UPDATE messages SET content=?, edited=1 WHERE id=?', [trimmed, msgId]);
  cache.delPattern(`search:*${userId}*`).catch(() => {});
  cache.del(cache.keys.conversations(userId)).catch(() => {});
  if (io) io.to(msg.conversation_id).emit('message_edited', { msgId, content: trimmed, conversationId: msg.conversation_id });
  return trimmed;
}

// ── 收藏 ────────────────────────────────────────────────────────
async function collect(userId, msgId) {
  const msg = db.prepare('SELECT * FROM messages WHERE id=? AND deleted=0').get(msgId);
  if (!msg) throw notFound('消息不存在或已删除');
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
  let parsedExtra = {};
  try { parsedExtra = JSON.parse(row?.extra || '{}') || {}; } catch { parsedExtra = {}; }
  return row ? { ...row, extra: parsedExtra } : { id };
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
  if (!q || !q.trim()) return [];
  if (q.length > 100) throw badRequest('搜索词过长');
  requireMember(convId, userId);

  // P2 优化：尝试从缓存获取搜索结果（TTL: 10 分钟）
  const cacheKey = `search:${convId}:${userId}:${q}`;
  let cachedResult = await cache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  // 使用 FTS5 全文索引，避免 LIKE '%kw%' 全表扫描
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const ftsQuery = tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
  const result = db.prepare(`
    SELECT m.*, u.username AS senderName, u.avatar AS senderAvatar
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.message_id AND m.deleted = 0
    JOIN users u ON u.id = m.sender_id
    WHERE messages_fts MATCH ? AND messages_fts.conversation_id = ?
    ORDER BY m.created_at DESC LIMIT 30
  `).all(ftsQuery, convId);

  // 写入缓存（TTL: 10 分钟）
  await cache.set(cacheKey, result, 600);

  return result;
}

// ── 跳转到指定消息的上下文（引用消息不在当前加载窗口时使用）──────
function aroundMessage(convId, msgId, userId) {
  requireMember(convId, userId);

  const clearClause = `AND m.created_at > COALESCE(
    (SELECT cleared_at FROM conversation_clears WHERE user_id=? AND conversation_id=m.conversation_id), 0
  )`;

  const target = db.prepare(`
    SELECT created_at FROM messages
    WHERE id=? AND conversation_id=? AND deleted=0
    AND created_at > COALESCE(
      (SELECT cleared_at FROM conversation_clears WHERE user_id=? AND conversation_id=?), 0
    )
  `).get(msgId, convId, userId, convId);
  if (!target) return null;

  const HALF = 25;
  const before = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.conversation_id=? AND m.created_at<=? AND m.deleted=0 ${clearClause}
    ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?
  `).all(convId, target.created_at, userId, HALF + 1);

  const after = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.conversation_id=? AND m.created_at>? AND m.deleted=0 ${clearClause}
    ORDER BY m.created_at ASC, m.rowid ASC LIMIT ?
  `).all(convId, target.created_at, userId, HALF);

  const hasMore = before.length > HALF;
  const messages = [...before.slice(0, HALF).reverse(), ...after];

  const replyIds = [...new Set(messages.filter(m => m.reply_to_id).map(m => m.reply_to_id))];
  const replyMap = new Map();
  if (replyIds.length > 0) {
    const ph = replyIds.map(() => '?').join(',');
    db.prepare(`
      SELECT m.id, m.type, m.content, m.file_url, m.deleted, u.username AS senderName
      FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id IN (${ph}) AND m.conversation_id=?
    `).all(...replyIds, convId).forEach(r => replyMap.set(r.id, r));
  }

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

  return {
    messages: messages.map(msg => {
      msg.replyTo   = msg.reply_to_id ? (replyMap.get(msg.reply_to_id) || null) : null;
      msg.reactions = reactionsMap.get(msg.id) || [];
      return msg;
    }),
    hasMore,
  };
}

module.exports = {
  history, missed, send, saveUploadedFile, forward, batchDelete,
  remove, react, edit, collect, searchGlobal, searchInConversation, aroundMessage,
};
