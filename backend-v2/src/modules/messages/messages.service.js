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
const { isMember, requireMember, memberRole, buildMessage, privateSendGuard } = require('./shared');
const cache = require('../../utils/cache');
const broadcaster = require('../../realtime/broadcaster');
// 会话列表缓存失效：发消息/转发/撤回改变会话「最新消息/排序」，需失效该会话所有成员
// (收发双方/群全员)的会话列表缓存。conversations.service 只 require messages/shared，无循环依赖。
const convSvc = require('../conversations/conversations.service');

const MAX = config.limits.maxMsgLength;

// ── 历史消息（批量 replyTo + reactions，群已读数 / 私聊送达）──────
function history(convId, userId, { before, after, limit, beforeId }) {
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
  if (hasBefore) {
    // created_at 为秒级：同一秒内消息数 > limit 时，仅用 created_at<before 会漏掉与游标同秒、
    // 超出上一页的消息。若客户端回传边界消息 id，则以 (created_at, rowid) 复合游标兜底，不丢不重。
    let beforeRowid = null;
    if (beforeId) {
      const r = db.prepare('SELECT rowid AS rid FROM messages WHERE id=? AND conversation_id=?').get(beforeId, convId);
      if (r) beforeRowid = r.rid;
    }
    if (beforeRowid != null) {
      query += ' AND (m.created_at < ? OR (m.created_at = ? AND m.rowid < ?))';
      params.push(beforeTs, beforeTs, beforeRowid);
    } else {
      query += ' AND m.created_at < ?';
      params.push(beforeTs);
    }
  }
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
  // 私聊守卫：黑名单 + 屏蔽陌生人合并校验（复用已取的 conv，省去重复 conversations 查询）
  const guardReason = privateSendGuard(convId, userId, conv);
  if (guardReason) throw forbidden(guardReason);
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
  // 失效该会话所有成员的会话列表缓存（收发双方/群全员），修复接收方列表 2s 内陈旧
  convSvc.invalidateConvCacheForConversation(convId);

  const msg = buildMessage(id);
  broadcaster.broadcastMessage(convId, msg);
  return msg;
}

// ── 文件消息（本地上传后入库 + 广播）───────────────────────────
async function saveUploadedFile(io, convId, userId, { type, content, fileUrl, reply_to_id }) {
  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, userId);
  if (!member) throw forbidden('无权发送');
  const conv = db.prepare('SELECT mute_all, type FROM conversations WHERE id=?').get(convId);
  if (conv?.mute_all && member.role === 'member') throw forbidden('全员禁言中，您没有发言权限');
  // 私聊守卫：黑名单 + 屏蔽陌生人合并校验（复用已取的 conv），防止陌生人用文件/图片/表情绕过设置骚扰
  const guardReason = privateSendGuard(convId, userId, conv);
  if (guardReason) throw forbidden(guardReason);
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
  convSvc.invalidateConvCacheForConversation(convId);
  const msg = buildMessage(id);
  broadcaster.broadcastMessage(convId, msg);
  return msg;
}

// ── 转发 ────────────────────────────────────────────────────────
async function forward(io, userId, { msgId, msgIds, conversationIds }) {
  // 兼容单条(msgId)与多条(msgIds)转发；统一去重、保序
  const rawIds = Array.isArray(msgIds) && msgIds.length ? msgIds : (msgId ? [msgId] : []);
  const ids = [...new Set(rawIds.filter(Boolean))];
  if (!ids.length || !conversationIds?.length) throw badRequest('参数缺失');
  if (conversationIds.length > 20) throw badRequest('单次转发最多20个会话');
  if (ids.length > 30) throw badRequest('单次最多转发30条消息');
  const FORWARDABLE_TYPES = new Set(['text', 'image', 'voice', 'video', 'file', 'contact_card']);

  // 逐条校验消息存在、类型可转发、且转发者是所在会话成员
  const msgs = [];
  for (const id of ids) {
    const m = db.prepare('SELECT * FROM messages WHERE id=? AND deleted=0').get(id);
    if (!m) throw notFound('消息不存在');
    if (!FORWARDABLE_TYPES.has(m.type)) throw badRequest('该类型消息不支持转发');
    requireMember(m.conversation_id, userId, '无权转发该消息');
    msgs.push(m);
  }

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
  // 目标会话过滤一次（与具体消息无关），再对每条消息生成插入
  const allowedConvIds = conversationIds.filter(convId => {
    if (!memberConvIds.has(convId)) return false;
    if (muteMap.get(convId) && roleMap.get(convId) === 'member') return false;
    // 私聊守卫：静默跳过被拉黑/已拉黑、或对方屏蔽陌生人且我非其好友的目标，防止用转发绕过
    if (privateSendGuard(convId, userId)) return false;
    return true;
  });
  // 保持消息原始顺序：外层消息、内层会话
  msgs.forEach(msg => {
    allowedConvIds.forEach(convId => {
      const id = uuidv4();
      ops.push({ sql: insertSql, params: [id, convId, userId, msg.type, msg.content, msg.file_url || '', msg.duration || 0] });
      targets.push({ convId, id });
    });
  });

  // P0-1：原子批次走 worker（保持"多条转发要么全成功要么全失败"语义），await 落库后再读回广播
  if (ops.length) await writeBatch(ops);
  if (ops.length) {
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    // 失效每个目标会话所有成员的会话列表缓存（去重）
    for (const cid of new Set(targets.map(t => t.convId))) convSvc.invalidateConvCacheForConversation(cid);
  }

  const selectStmt = db.prepare('SELECT m.*, u.username as senderName, u.avatar as senderAvatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?');
  targets.forEach(({ convId, id }) => {
    const newMsg = selectStmt.get(id);
    if (!newMsg) return;
    newMsg.reactions = [];
    broadcaster.broadcastMessage(convId, newMsg);
  });
  // 返回目标会话去重数（前端按"发送给 N 个会话"提示，与单条转发语义一致）
  return new Set(targets.map(t => t.convId)).size;
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
      ops.push({ sql: "UPDATE messages SET deleted=2, content='', file_url='' WHERE id=?", params: [msg.id] });
      deleted.push(msg.id);
    }
  });
  // P0-1：原子批次走 worker，落库后再广播
  if (ops.length) await writeBatch(ops);
  if (ops.length) {
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    convSvc.invalidateConvCacheForConversation(conversationId);
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
    convSvc.invalidateConvCacheForConversation(msg.conversation_id);
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
    // 撤回不限时间：任意时长的消息本人（或群管理员）均可撤回
    await writeAsync("UPDATE messages SET deleted=2, content='', file_url='' WHERE id=?", [msgId]);
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    convSvc.invalidateConvCacheForConversation(msg.conversation_id);
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
  // 编辑不限时间：本人文字消息任意时长均可编辑

  const trimmed = content.trim();
  // P0-1：worker 异步写，await 落库后再广播
  await writeAsync('UPDATE messages SET content=?, edited=1 WHERE id=?', [trimmed, msgId]);
  cache.delPattern(`search:*${userId}*`).catch(() => {});
  convSvc.invalidateConvCacheForConversation(msg.conversation_id);
  if (io) io.to(msg.conversation_id).emit('message_edited', { msgId, content: trimmed, conversationId: msg.conversation_id });
  return trimmed;
}

// ── 收藏 ────────────────────────────────────────────────────────
async function collect(userId, msgId) {
  const msg = db.prepare('SELECT * FROM messages WHERE id=? AND deleted=0').get(msgId);
  if (!msg) throw notFound('消息不存在或已删除');
  requireMember(msg.conversation_id, userId, '无权操作');
  const extra = { file_url: msg.file_url, source_msg_id: msg.id, source_conv_id: msg.conversation_id };
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

  // trigram 分词器要求 token ≥ 3 字符；1~2 字（中文名/单字词极常见）FTS 无法命中，
  // 退化为 LIKE 精确子串匹配，避免短词全局搜索恒空（与 searchInConversation 一致）。
  const trimmed = q.trim();
  const useLike = trimmed.length < 3;

  let total, rows;
  if (useLike) {
    const like = '%' + trimmed.replace(/[\\%_]/g, c => '\\' + c) + '%';
    total = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
      WHERE m.type = 'text' AND m.deleted = 0 AND m.content LIKE ? ESCAPE '\\'
    `).get(userId, like)?.cnt || 0;

    rows = db.prepare(`
      SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at,
             u.username AS senderName, u.avatar AS senderAvatar,
             c.name AS convName, c.type AS convType,
             ou.id AS ou_id, ou.username AS ou_username, ou.avatar AS ou_avatar, ou.status AS ou_status
      FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
      JOIN users u ON u.id = m.sender_id
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN conversation_members cm_o
             ON cm_o.conversation_id = m.conversation_id AND cm_o.user_id != ? AND c.type = 'private'
      LEFT JOIN users ou ON ou.id = cm_o.user_id
      WHERE m.type = 'text' AND m.deleted = 0 AND m.content LIKE ? ESCAPE '\\'
      ORDER BY m.created_at DESC LIMIT ? OFFSET ?
    `).all(userId, userId, like, safeLimit, safeOffset);
  } else {
    // FTS5 phrase query: double-quote wrap 防止特殊字符被解析为 FTS5 语法
    const ftsQuery = '"' + trimmed.replace(/"/g, '""') + '"';

    total = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.message_id AND m.deleted = 0
      JOIN conversation_members cm ON cm.conversation_id = messages_fts.conversation_id AND cm.user_id = ?
      WHERE messages_fts MATCH ?
    `).get(userId, ftsQuery)?.cnt || 0;

    rows = db.prepare(`
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
  }

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

  // trigram 分词器要求 token ≥ 3 字符；1~2 字（中文极常见）FTS 无法命中，
  // 退化为 LIKE 精确子串匹配，避免短词搜索恒空。
  const maxTokenLen = Math.max(...tokens.map(t => t.length));
  let result;
  if (maxTokenLen < 3) {
    const like = `%${q.trim().replace(/[\\%_]/g, c => '\\' + c)}%`;
    result = db.prepare(`
      SELECT m.*, u.username AS senderName, u.avatar AS senderAvatar
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ? AND m.deleted = 0
        AND m.content LIKE ? ESCAPE '\\'
      ORDER BY m.created_at DESC LIMIT 30
    `).all(convId, like);
  } else {
    const ftsQuery = tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    result = db.prepare(`
      SELECT m.*, u.username AS senderName, u.avatar AS senderAvatar
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.message_id AND m.deleted = 0
      JOIN users u ON u.id = m.sender_id
      WHERE messages_fts MATCH ? AND messages_fts.conversation_id = ?
      ORDER BY m.created_at DESC LIMIT 30
    `).all(ftsQuery, convId);
  }

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

// ── 聊天记录导出（单会话，最多 10000 条，返回 UTF-8 纯文本）──────
function exportConversation(convId, userId) {
  requireMember(convId, userId);

  const conv = db.prepare('SELECT type, name FROM conversations WHERE id=?').get(convId);

  // 最多导出 10000 条，按时间升序
  const msgs = db.prepare(`
    SELECT m.created_at, m.type, m.content, m.file_url, m.deleted,
           u.username AS senderName
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.conversation_id=? AND m.deleted=0
    ORDER BY m.created_at ASC, m.rowid ASC
    LIMIT 10000
  `).all(convId, );

  // 非文本消息的类型标注（transfer/red_packet 单独展开，见下方 formatBody）
  const typeLabel = {
    image: '[图片]', voice: '[语音]', video: '[视频]',
    file: '[文件]', sticker: '[表情包]',
    contact_card: '[名片]', nudge: '[拍一拍]',
  };

  // 转账/红包展开：content 是 JSON。转账展开金额+备注，红包展开祝福语。
  // 解析失败时回退到占位符，保证导出不因单条脏数据中断。
  const formatBody = (m) => {
    if (m.type === 'transfer') {
      try {
        const d = JSON.parse(m.content);
        const amount = Number(d.amount) || 0;
        const note = d.note ? ` 备注:${d.note}` : '';
        return `[转账] ${amount} 金币${note}`;
      } catch { return '[转账]'; }
    }
    if (m.type === 'red_packet') {
      try {
        const d = JSON.parse(m.content);
        const greet = d.greeting ? ` ${d.greeting}` : '';
        return `[红包]${greet}`;
      } catch { return '[红包]'; }
    }
    if (typeLabel[m.type]) return typeLabel[m.type];
    return m.content || '';
  };

  const fmtTime = (sec) => {
    try {
      return new Date(sec * 1000).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
    } catch { return String(sec); }
  };

  const convTitle = conv?.name || convId;
  const lines = [
    `=== 聊天记录：${convTitle} ===`,
    `导出时间：${fmtTime(Math.floor(Date.now() / 1000))}`,
    `消息条数：${msgs.length}`,
    '────────────────────────────────',
    '',
  ];

  for (const m of msgs) {
    const time    = fmtTime(m.created_at);
    const sender  = m.senderName || '未知用户';
    const body    = formatBody(m);
    lines.push(`[${time}] ${sender}`);
    lines.push(body);
    lines.push('');
  }

  return lines.join('\n');
}

// ── 聊天文件聚合视图（会话内图片/视频/文件按类型列表）──────────────
function getConversationFiles(convId, userId, { type = 'all', offset = 0, limit = 50 }) {
  requireMember(convId, userId);

  const safeLimit  = Math.min(Math.max(parseInt(limit)  || 50, 1), 100);
  const safeOffset = Math.max(parseInt(offset) || 0, 0);

  // type 参数映射到 SQL 条件（参数化，防 SQL 注入）
  const VALID_TYPES = { image: ['image'], video: ['video'], file: ['file'], all: ['image', 'video', 'file'] };
  const types = VALID_TYPES[type] || VALID_TYPES.all;
  const ph    = types.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT m.id, m.type, m.content, m.file_url, m.created_at,
           u.username AS sender_name, u.avatar AS sender_avatar
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? AND m.deleted = 0
      AND m.type IN (${ph})
    ORDER BY m.created_at DESC, m.rowid DESC
    LIMIT ? OFFSET ?
  `).all(convId, ...types, safeLimit, safeOffset);

  const { cnt: total } = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM messages m
    WHERE m.conversation_id = ? AND m.deleted = 0
      AND m.type IN (${ph})
  `).get(convId, ...types);

  return {
    items: rows.map(r => ({
      id:           r.id,
      type:         r.type,
      fileName:     r.content || '',   // file/image 消息的 content = 原始文件名
      fileUrl:      r.file_url || '',
      createdAt:    r.created_at,
      senderName:   r.sender_name,
      senderAvatar: r.sender_avatar,
    })),
    total,
    offset: safeOffset,
    limit:  safeLimit,
  };
}

// ── @我的消息聚合（所有会话中 @自己 的消息）──────────────────────
function getMentions(userId, { offset = 0, limit = 20 }) {
  const safeLimit  = Math.min(Math.max(parseInt(limit)  || 20, 1), 50);
  const safeOffset = Math.max(parseInt(offset) || 0, 0);

  // 查当前用户昵称（@提及用 @username 形式存在 content 里）
  const me = db.prepare('SELECT username FROM users WHERE id=?').get(userId);
  if (!me) return { items: [], total: 0 };

  const mention = '@' + me.username;

  // 查所有会话内 @我的消息（instr 避免 LIKE 通配歧义）
  const rows = db.prepare(`
    SELECT m.id, m.conversation_id, m.content, m.created_at, m.sender_id,
           u.username AS sender_name,
           c.name AS conv_name, c.type AS conv_type
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    JOIN conversations c ON c.id = m.conversation_id
    JOIN conversation_members cm
         ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
    WHERE m.deleted = 0
      AND m.sender_id != ?
      AND instr(m.content, ?) > 0
    ORDER BY m.created_at DESC, m.rowid DESC
    LIMIT ? OFFSET ?
  `).all(userId, userId, mention, safeLimit, safeOffset);

  const { cnt: total } = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM messages m
    JOIN conversation_members cm
         ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
    WHERE m.deleted = 0
      AND m.sender_id != ?
      AND instr(m.content, ?) > 0
  `).get(userId, userId, mention);

  return {
    items: rows.map(r => ({
      msgId:      r.id,
      convId:     r.conversation_id,
      convName:   r.conv_name || '私聊',
      convType:   r.conv_type,
      senderName: r.sender_name,
      content:    r.content.length > 120 ? r.content.slice(0, 120) + '…' : r.content,
      createdAt:  r.created_at,
    })),
    total,
  };
}

// ── 语音转文字（ASR）───────────────────────────────────────────
// 读取语音消息音频 → 调独立 faster-whisper 服务 → 结果落 messages.transcript 缓存。
// 幂等：已转写过直接回缓存，不再重复调用 ASR。服务不可用抛 AsrUnavailableError，
// 由 controller 转 503，前端提示「转写服务暂不可用」，绝不降级假数据。
async function transcribe(userId, msgId) {
  // 1) 取消息并校验：必须存在、未删除、类型为 voice
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
  if (!msg || msg.deleted) throw notFound('消息不存在');
  if (msg.type !== 'voice') throw badRequest('仅语音消息支持转文字');

  // 2) 权限：必须是该会话成员（自己发的和收到的都可点，与微信一致）
  requireMember(msg.conversation_id, userId, '无权访问该消息');

  // 3) 幂等：已有转写结果直接命中缓存
  if (msg.transcript != null && msg.transcript !== '') {
    return { text: msg.transcript, cached: true };
  }

  // 4) 读取音频字节：本地 /uploads/* 走文件系统；http(s) 云地址走网络拉取
  const buf = await readVoiceAudio(msg.file_url);
  const filename = deriveAudioName(msg.file_url, msg.content);

  // 5) 调 ASR 服务真实转写
  const { transcribe: asrTranscribe } = require('../../utils/asrClient');
  const { text } = await asrTranscribe(buf, filename, 'auto');

  // 空转写（纯静音/无语音）也如实缓存空结果，避免反复调用；前端按空文本提示
  const finalText = text || '';

  // 6) 落库缓存
  await writeAsync('UPDATE messages SET transcript=? WHERE id=?', [finalText, msgId]);

  return { text: finalText, cached: false };
}

// 从 file_url 读取音频原始字节。支持本地 uploads 路径与远程 http(s) 云地址。
async function readVoiceAudio(fileUrl) {
  if (!fileUrl) throw badRequest('该语音消息缺少音频文件');
  const fs = require('fs');
  const path = require('path');

  // 云直传地址（https://…）：网络拉取
  if (/^https?:\/\//i.test(fileUrl)) {
    const resp = await fetch(fileUrl);
    if (!resp.ok) throw badRequest('无法下载语音音频文件');
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  }

  // 本地 /uploads/xxx → 映射到 config.uploadsRoot 下的物理文件。
  // 防路径穿越：解析后必须仍在 uploadsRoot 内。
  const rel = fileUrl.replace(/^\/?uploads\//, '');
  const abs = path.resolve(config.uploadsRoot, rel);
  const rootResolved = path.resolve(config.uploadsRoot);
  if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) {
    throw badRequest('非法的音频文件路径');
  }
  if (!fs.existsSync(abs)) throw notFound('语音音频文件不存在');
  return fs.promises.readFile(abs);
}

// 从 URL / content 推导带扩展名的文件名，供 ASR 服务识别容器格式。
function deriveAudioName(fileUrl, content) {
  const path = require('path');
  let name = '';
  try { name = path.basename((fileUrl || '').split('?')[0]); } catch { name = ''; }
  if (name && /\.[a-z0-9]{1,5}$/i.test(name)) return name;
  if (content && /\.[a-z0-9]{1,5}$/i.test(content)) return content;
  return 'voice.webm'; // 前端录音默认 webm
}

module.exports = {
  history, missed, send, saveUploadedFile, forward, batchDelete,
  remove, react, edit, collect, searchGlobal, searchInConversation, aroundMessage,
  exportConversation, getConversationFiles, getMentions, transcribe,
};
