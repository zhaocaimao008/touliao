'use strict';
/**
 * 消息域 service。保留历史查询的批量化优化（N+1→2 query）与 FTS5 搜索。
 * P2 优化：集成 Redis 缓存
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { writeAsync, writeBatch, SEQUENCE_PARAM } = require('../../db/writer');
const config = require('../../config');
const { badRequest, forbidden, notFound, conflict } = require('../../utils/http');
const { collectionDedupKey } = require('../../utils/collections');
const { isMember, requireMember, memberRole, buildMessage, privateSendGuard } = require('./shared');
const cache = require('../../utils/cache');
const broadcaster = require('../../realtime/broadcaster');
// 会话列表缓存失效：发消息/转发/撤回改变会话「最新消息/排序」，需失效该会话所有成员
// (收发双方/群全员)的会话列表缓存。conversations.service 只 require messages/shared，无循环依赖。
const convSvc = require('../conversations/conversations.service');
const { shareFileToConversation } = require('../../utils/fileRegistry');
const { appendConversationEvent, emitSyncAvailable } = require('./sync.service');
const moderation = require('../moderation/moderation.service');

const MAX = config.limits.maxMsgLength;

// ── 历史消息（批量 replyTo + reactions，群已读数 / 私聊送达）──────
function history(convId, userId, { before, after, limit, beforeId }) {
  requireMember(convId, userId);

  const rawLimit = parseInt(limit);
  const lim = (!isNaN(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 100) : 50;

  // per-user tombstone：个人删除的消息（deleted=0 但 user_message_deletions 有记录）对当前用户不可见
  const userDelClause = `AND NOT EXISTS (
    SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?
  )`;
  let query = `
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.conversation_id=? AND m.deleted=0 ${userDelClause}
      AND m.rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears WHERE user_id=? AND conversation_id=m.conversation_id), 0
      )
  `;
  const params = [convId, userId, userId];
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
  let readSet = new Set();
  let peerLastReadAt = 0;
  if (conv?.type === 'private' && messages.length > 0) {
    const ids = messages.map(m => m.id);
    const ph = ids.map(() => '?').join(',');
    db.prepare(`SELECT message_id FROM message_deliveries WHERE message_id IN (${ph})`).all(...ids)
      .forEach(r => deliverySet.add(r.message_id));
    const peerRow = db.prepare(
      'SELECT user_id, last_read_at FROM conversation_settings WHERE conversation_id=? AND user_id!=? LIMIT 1'
    ).get(convId, userId);
    peerLastReadAt = peerRow?.last_read_at || 0;
    // 消息级已读回执（message_reads 持久化；发送者据此显示蓝色双勾）
    if (peerRow?.user_id) {
      db.prepare(`SELECT message_id FROM message_reads WHERE user_id=? AND message_id IN (${ph})`).all(peerRow.user_id, ...ids)
        .forEach(r => readSet.add(r.message_id));
    }
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
      msg._read = readSet.has(msg.id) || (msg.sender_id === userId && peerLastReadAt > 0 && msg.created_at <= peerLastReadAt);
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
      AND NOT EXISTS (SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?)
      AND m.rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears
                                   WHERE user_id=? AND conversation_id=m.conversation_id), 0)
    ORDER BY m.created_at ASC LIMIT 300
  `).all(...convIds, after, userId, userId);

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
  moderation.assertClean(content);
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
  const sequenced = await appendConversationEvent({
    conversationId: convId, eventType: 'message_created', messageId: id, actorId: userId,
    ops: [{
      sql: 'INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id,server_sequence) VALUES (?,?,?,?,?,?,?)',
      params: [id, convId, userId, safeType, content, reply_to_id || null, SEQUENCE_PARAM],
    }],
  });

  // #4 尾延迟：缓存失效是非关键写，改后台异步执行，不阻塞响应
  cache.delPattern(`search:*${userId}*`).catch(() => {});
  // 失效该会话所有成员的会话列表缓存（收发双方/群全员），修复接收方列表 2s 内陈旧
  convSvc.invalidateConvCacheForConversation(convId);

  const msg = buildMessage(id);
  broadcaster.broadcastMessage(convId, msg);
  emitSyncAvailable(io, convId, sequenced.server_sequence);

  // AI 助手：私聊发给 AI 账号 → 异步转 OpenClaw 生成回复（不阻塞主链路）
  const aiAssistant = require('../ai-assistant/assistant.service');
  aiAssistant.maybeReply(io, convId, userId, msg).catch(() => {});

  return msg;
}

// ── 文件消息（本地上传后入库 + 广播）───────────────────────────
async function saveUploadedFile(io, convId, userId, { type, content, fileUrl, reply_to_id, fileMime, fileSize, duration }) {
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
  // file_mime/file_size：供前端渲染文件卡片(类型图标/大小)，来自上传时服务端已验证过的
  // 真实值(魔数校验后的mime、实际接收字节数)，不信任客户端可另外声称的值。
  const sequenced = await appendConversationEvent({
    conversationId: convId, eventType: 'message_created', messageId: id, actorId: userId,
    ops: [{
      sql: 'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,reply_to_id,file_mime,file_size,duration,server_sequence) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      params: [id, convId, userId, type, content, fileUrl, reply_to_id || null, fileMime || null, fileSize || null, duration || 0, SEQUENCE_PARAM],
    }],
  });
  cache.delPattern(`search:*${userId}*`).catch(() => {});
  convSvc.invalidateConvCacheForConversation(convId);
  const msg = buildMessage(id);
  broadcaster.broadcastMessage(convId, msg);
  emitSyncAvailable(io, convId, sequenced.server_sequence);

  // AI 助手：图片发到 AI 账号 → 视觉识别 + 大脑回复（与文本 send() 路径一致）
  if (type === 'image') {
    const aiAssistant = require('../ai-assistant/assistant.service');
    aiAssistant.maybeReply(io, convId, userId, msg).catch(() => {});
  }
  return msg;
}

// ── 转发 ────────────────────────────────────────────────────────
async function forward(io, userId, { msgId, msgIds, conversationIds, client_batch_id: requestedClientBatchId }) {
  // 兼容单条(msgId)与多条(msgIds)转发；统一去重、保序
  const rawIds = Array.isArray(msgIds) && msgIds.length ? msgIds : (msgId ? [msgId] : []);
  const ids = [...new Set(rawIds.filter(Boolean))];
  if (!ids.length || !conversationIds?.length) throw badRequest('参数缺失');
  if (conversationIds.length > 20) throw badRequest('单次转发最多20个会话');
  if (ids.length > 30) throw badRequest('单次最多转发30条消息');
  const FORWARDABLE_TYPES = new Set(['text', 'image', 'voice', 'video', 'file', 'contact_card']);

  const clientBatchId = typeof requestedClientBatchId === 'string' && requestedClientBatchId.trim()
    ? requestedClientBatchId.trim().slice(0, 128) : uuidv4();
  const existingBatch = db.prepare('SELECT * FROM message_forward_batches WHERE actor_id=? AND client_batch_id=?')
    .get(userId, clientBatchId);
  if (existingBatch) {
    return {
      batch_id: existingBatch.batch_id, client_batch_id: existingBatch.client_batch_id,
      status: existingBatch.status, total: existingBatch.total,
      success_count: existingBatch.success_count, failed_count: existingBatch.failed_count,
      failed_message_ids: JSON.parse(existingBatch.failed_message_ids || '[]'),
      retryable_message_ids: JSON.parse(existingBatch.retryable_message_ids || '[]'),
      sent: existingBatch.success_count,
    };
  }
  const batchId = uuidv4();
  db.prepare(`INSERT INTO message_forward_batches
    (batch_id,actor_id,client_batch_id,status,total) VALUES (?,?,?,'processing',?)`)
    .run(batchId, userId, clientBatchId, ids.length);

  // 逐条校验消息存在、类型可转发、且转发者是所在会话成员；失败保留在批次结果中，避免伪装成全成功。
  const msgs = [];
  const failedMessageIds = [];
  const failureReasons = new Map();
  for (const id of ids) {
    const m = db.prepare('SELECT * FROM messages WHERE id=? AND deleted=0').get(id);
    if (!m || !FORWARDABLE_TYPES.has(m.type)) { failedMessageIds.push(id); failureReasons.set(id, '消息不存在或不支持转发'); continue; }
    try { requireMember(m.conversation_id, userId, '无权转发该消息'); }
    catch { failedMessageIds.push(id); failureReasons.set(id, '无权转发该消息'); continue; }
    msgs.push(m);
  }

  const targets = [];   // { convId, id, source }
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
      targets.push({ convId, id, source: msg });
      // 转发者此刻已通过上面的 requireMember(m.conversation_id,...) 与 allowedConvIds 过滤，
      // 即已合法持有该文件的原始访问权、且 convId 是转发者本人真实所在的会话——在此把
      // (file_url, convId) 登记进 file_registry_shares，供 /uploads 授权判断识别"转发到的
      // 新会话成员"，而不必信任 messages 表本身（登记动作只由服务端在这条已校验路径上触发）。
      if (msg.file_url) shareFileToConversation(msg.file_url, convId);
    });
  });

  // 每一条转发消息和其同步事件在同一事务提交；服务端为目标会话分配严格递增序列。
  const successfulSourceIds = new Set();
  const writeFailedSourceIds = new Set();
  for (const target of targets) {
    const { convId, id, source } = target;
    try {
      const sequenced = await appendConversationEvent({
        conversationId: convId, eventType: 'message_created', messageId: id, actorId: userId,
        batchId, clientBatchId,
        payload: { batch_id: batchId, client_batch_id: clientBatchId, source_message_id: source.id },
        ops: [{
          sql: 'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,duration,batch_id,client_batch_id,server_sequence) VALUES (?,?,?,?,?,?,?,?,?,?)',
          params: [id, convId, userId, source.type, source.content, source.file_url || '', source.duration || 0, batchId, clientBatchId, SEQUENCE_PARAM],
        }],
      });
      target.serverSequence = sequenced.server_sequence;
      successfulSourceIds.add(source.id);
    } catch (error) {
      writeFailedSourceIds.add(source.id);
      failureReasons.set(source.id, error.message || '转发写入失败');
    }
  }
  if (!allowedConvIds.length) msgs.forEach(source => {
    writeFailedSourceIds.add(source.id);
    failureReasons.set(source.id, '没有可用的目标会话');
  });
  writeFailedSourceIds.forEach(id => { if (!successfulSourceIds.has(id)) failedMessageIds.push(id); });
  const uniqueFailedIds = [...new Set(failedMessageIds)];
  const successCount = ids.length - uniqueFailedIds.length;
  const status = successCount === ids.length ? 'success' : successCount > 0 ? 'partial_success' : 'failed';
  const retryableIds = uniqueFailedIds.filter(id => failureReasons.has(id));
  db.prepare(`UPDATE message_forward_batches SET status=?, success_count=?, failed_count=?,
    failed_message_ids=?, retryable_message_ids=?, updated_at=strftime('%s','now') WHERE batch_id=?`)
    .run(status, successCount, uniqueFailedIds.length, JSON.stringify(uniqueFailedIds), JSON.stringify(retryableIds), batchId);
  if (targets.length) {
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    // 失效每个目标会话所有成员的会话列表缓存（去重）
    for (const cid of new Set(targets.map(t => t.convId))) convSvc.invalidateConvCacheForConversation(cid);
  }

  const selectStmt = db.prepare('SELECT m.*, u.username as senderName, u.avatar as senderAvatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?');
  targets.forEach(({ convId, id, serverSequence }) => {
    const newMsg = selectStmt.get(id);
    if (!newMsg) return;
    newMsg.reactions = [];
    broadcaster.broadcastMessage(convId, newMsg);
    emitSyncAvailable(io, convId, serverSequence);
  });
  return {
    batch_id: batchId, client_batch_id: clientBatchId, status,
    total: ids.length, success_count: successCount, failed_count: uniqueFailedIds.length,
    failed_message_ids: uniqueFailedIds, retryable_message_ids: retryableIds,
    sent: new Set(targets.filter(t => t.serverSequence != null).map(t => t.convId)).size,
  };
}

// ── 批量撤回 ────────────────────────────────────────────────────
async function batchDelete(io, userId, { msgIds, conversationId }) {
  if (!msgIds?.length || !conversationId) throw badRequest('参数缺失');
  if (msgIds.length > 20) throw badRequest('单次最多批量撤回 20 条');
  const role = memberRole(conversationId, userId);
  if (!role) throw forbidden('不在会话中');

  const isAdmin = role === 'owner' || role === 'admin';
  const now = Math.floor(Date.now() / 1000);
  const deleted = [];
  // 批量查询代替 N 次单独 SELECT
  const ph2 = msgIds.map(() => '?').join(',');
  const msgs = db.prepare(`SELECT * FROM messages WHERE id IN (${ph2}) AND conversation_id=? AND deleted=0`).all(...msgIds, conversationId);
  msgs.forEach(msg => {
    const isOwn = msg.sender_id === userId;
    if (isOwn || isAdmin) {
      deleted.push(msg.id);
    }
  });
  const sequences = [];
  for (const id of deleted) {
    const sequenced = await appendConversationEvent({
      conversationId, eventType: 'message_recalled', messageId: id, actorId: userId,
      ops: [{ sql: "UPDATE messages SET deleted=2, content='', file_url='' WHERE id=?", params: [id] }],
    });
    sequences.push(sequenced.server_sequence);
  }
  if (deleted.length) {
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    convSvc.invalidateConvCacheForConversation(conversationId);
  }
  // 批量 emit（单次事件，减少前端重渲染次数）
  if (io && deleted.length > 0) io.to(conversationId).emit('messages_batch_deleted', { msgIds: deleted, conversationId });
  if (sequences.length) emitSyncAvailable(io, conversationId, sequences[sequences.length - 1]);
  return deleted.length;
}

// ── 单条撤回 / 个人删除 / 彻底删除 ───────────────────────────────
async function remove(io, userId, msgId, forEveryone, vanish, forMe) {
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
  if (!msg) throw notFound('消息不存在');

  if (vanish) {
    // 彻底删除不留痕迹：内容清空，deleted=2，对方也不见任何提示
    const callerRole = memberRole(msg.conversation_id, userId);
    if (!callerRole) throw forbidden('您已不在该会话中');
    const isAdmin = callerRole === 'owner' || callerRole === 'admin';
    if (msg.sender_id !== userId && !isAdmin) throw forbidden('无权删除该消息');
    const sequenced = await appendConversationEvent({
      conversationId: msg.conversation_id, eventType: 'message_vanished', messageId: msgId, actorId: userId,
      ops: [{ sql: "UPDATE messages SET deleted=2, content='', file_url='' WHERE id=?", params: [msgId] }],
    });
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    convSvc.invalidateConvCacheForConversation(msg.conversation_id);
    if (io) io.to(msg.conversation_id).emit('message_vanished', { msgId, conversationId: msg.conversation_id });
    emitSyncAvailable(io, msg.conversation_id, sequenced.server_sequence);
    return;
  }

  // 个人删除（per-user tombstone）：仅对当前账号生效，对方/群成员不受影响。
  // 广播到 user_{userId} 房间 → 当前账号所有在线设备同步移除；不触碰 messages 行。
  if (forMe) {
    const callerRole = memberRole(msg.conversation_id, userId);
    if (!callerRole) throw forbidden('您已不在该会话中');
    const existingDeletion = db.prepare('SELECT 1 FROM user_message_deletions WHERE message_id=? AND user_id=?').get(msgId, userId);
    if (existingDeletion) return;
    const sequenced = await appendConversationEvent({
      conversationId: msg.conversation_id, eventType: 'message_deleted_for_me', messageId: msgId,
      actorId: userId, targetUserId: userId,
      ops: [{ sql: 'INSERT INTO user_message_deletions (message_id, user_id) VALUES (?, ?)', params: [msgId, userId] }],
    });
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    convSvc.invalidateConvCacheForConversation(msg.conversation_id);
    if (io) {
      io.to(`user_${userId}`).emit('message_deleted_for_me', {
        msgId,
        conversationId: msg.conversation_id,
        operatorId: userId,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
    emitSyncAvailable(io, msg.conversation_id, sequenced.server_sequence);
    return;
  }

  if (forEveryone) {
    const isOwn = msg.sender_id === userId;
    const callerRole = memberRole(msg.conversation_id, userId);
    if (!callerRole) throw forbidden('您已不在该会话中');
    const isAdmin = callerRole === 'owner' || callerRole === 'admin';
    if (!isOwn && !isAdmin) throw forbidden('无权删除该消息');
    if (msg.deleted === 2) return; // 幂等：已撤回的消息再次撤回直接成功返回，不报错不重复广播
    // 撤回不限时间：任意时长的消息本人（或群管理员）均可撤回
    const sequenced = await appendConversationEvent({
      conversationId: msg.conversation_id, eventType: 'message_recalled', messageId: msgId, actorId: userId,
      ops: [{ sql: "UPDATE messages SET deleted=2, content='', file_url='' WHERE id=?", params: [msgId] }],
    });
    cache.delPattern(`search:*${userId}*`).catch(() => {});
    convSvc.invalidateConvCacheForConversation(msg.conversation_id);
    const now = Math.floor(Date.now() / 1000);
    if (io) {
      // message_recall：新协议，撤回同步（含 operator_id/timestamp，幂等）
      io.to(msg.conversation_id).emit('message_recall', {
        msgId,
        conversationId: msg.conversation_id,
        operatorId: userId,
        timestamp: now,
      });
      // message_deleted：保留旧协议兼容（Android/iOS 原生端仍监听此事件）
      io.to(msg.conversation_id).emit('message_deleted', { msgId, conversationId: msg.conversation_id });
    }
    emitSyncAvailable(io, msg.conversation_id, sequenced.server_sequence);
  }
  // 仅自己隐藏：已由 forMe 分支持久化处理
}

// ── 管理员撤回（内容审核，2026-09-02）───────────────────────────
// 复用 remove() forEveryone 分支同一套 DB 语义(deleted=2/清内容/message_recall 广播)，
// 跳过会话成员/角色校验——平台管理员权限高于群管理员，且管理员本就不在会话内。
// 广播 operatorId 用消息原发送者 id（而非虚构一个"admin"用户），客户端渲染就是普通撤回，
// 不需要为"谁撤回的"这个字段专门处理一个不存在的用户 id。
async function adminRecall(io, msgId) {
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
  if (!msg) throw notFound('消息不存在');
  if (msg.deleted === 2) return; // 幂等
  const sequenced = await appendConversationEvent({
    conversationId: msg.conversation_id, eventType: 'message_recalled', messageId: msgId, actorId: msg.sender_id,
    ops: [{ sql: "UPDATE messages SET deleted=2, content='', file_url='' WHERE id=?", params: [msgId] }],
  });
  cache.delPattern(`search:*${msg.sender_id}*`).catch(() => {});
  convSvc.invalidateConvCacheForConversation(msg.conversation_id);
  const now = Math.floor(Date.now() / 1000);
  if (io) {
    io.to(msg.conversation_id).emit('message_recall', {
      msgId, conversationId: msg.conversation_id, operatorId: msg.sender_id, timestamp: now,
    });
    io.to(msg.conversation_id).emit('message_deleted', { msgId, conversationId: msg.conversation_id });
  }
  emitSyncAvailable(io, msg.conversation_id, sequenced.server_sequence);
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
  moderation.assertClean(content.trim());
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
  if (!msg) throw notFound('消息不存在');
  if (msg.sender_id !== userId) throw forbidden('只能编辑自己的消息');
  requireMember(msg.conversation_id, userId, '您已不在该会话中，无法编辑消息');
  if (msg.type !== 'text') throw badRequest('只能编辑文字消息');
  if (msg.deleted) throw badRequest('已撤回的消息无法编辑');
  // 编辑不限时间：本人文字消息任意时长均可编辑

  const trimmed = content.trim();
  // P0-1：worker 异步写，await 落库后再广播
  const sequenced = await appendConversationEvent({
    conversationId: msg.conversation_id, eventType: 'message_edited', messageId: msgId, actorId: userId,
    payload: { content: trimmed },
    ops: [{ sql: 'UPDATE messages SET content=?, edited=1 WHERE id=?', params: [trimmed, msgId] }],
  });
  cache.delPattern(`search:*${userId}*`).catch(() => {});
  convSvc.invalidateConvCacheForConversation(msg.conversation_id);
  if (io) io.to(msg.conversation_id).emit('message_edited', { msgId, content: trimmed, conversationId: msg.conversation_id });
  emitSyncAvailable(io, msg.conversation_id, sequenced.server_sequence);
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
        AND NOT EXISTS (SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?)
        AND m.rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears
                                     WHERE user_id=? AND conversation_id=m.conversation_id), 0)
    `).get(userId, like, userId, userId)?.cnt || 0;

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
             ON cm_o.conversation_id = m.conversation_id AND c.type = 'private'
            AND cm_o.user_id = (
                  SELECT user_id FROM conversation_members
                  WHERE conversation_id = m.conversation_id AND user_id != ?
                  ORDER BY user_id LIMIT 1
                )
      LEFT JOIN users ou ON ou.id = cm_o.user_id
      WHERE m.type = 'text' AND m.deleted = 0 AND m.content LIKE ? ESCAPE '\\'
        AND NOT EXISTS (SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?)
        AND m.rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears
                                     WHERE user_id=? AND conversation_id=m.conversation_id), 0)
      ORDER BY m.created_at DESC LIMIT ? OFFSET ?
    `).all(userId, userId, like, userId, userId, safeLimit, safeOffset);
  } else {
    // FTS5 phrase query: double-quote wrap 防止特殊字符被解析为 FTS5 语法
    const ftsQuery = '"' + trimmed.replace(/"/g, '""') + '"';

    total = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.message_id AND m.deleted = 0
      JOIN conversation_members cm ON cm.conversation_id = messages_fts.conversation_id AND cm.user_id = ?
      WHERE messages_fts MATCH ?
        AND NOT EXISTS (SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?)
        AND m.rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears
                                     WHERE user_id=? AND conversation_id=m.conversation_id), 0)
    `).get(userId, ftsQuery, userId, userId)?.cnt || 0;

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
             ON cm_o.conversation_id = m.conversation_id AND c.type = 'private'
            AND cm_o.user_id = (
                  SELECT user_id FROM conversation_members
                  WHERE conversation_id = m.conversation_id AND user_id != ?
                  ORDER BY user_id LIMIT 1
                )
      LEFT JOIN users ou ON ou.id = cm_o.user_id
      WHERE messages_fts MATCH ?
        AND NOT EXISTS (SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?)
        AND m.rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears
                                     WHERE user_id=? AND conversation_id=m.conversation_id), 0)
      ORDER BY m.created_at DESC LIMIT ? OFFSET ?
    `).all(userId, userId, ftsQuery, userId, userId, safeLimit, safeOffset);
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
        AND NOT EXISTS (SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?)
        AND m.rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears WHERE user_id=? AND conversation_id=m.conversation_id), 0)
      ORDER BY m.created_at DESC LIMIT 30
    `).all(convId, like, userId, userId);
  } else {
    const ftsQuery = tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    result = db.prepare(`
      SELECT m.*, u.username AS senderName, u.avatar AS senderAvatar
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.message_id AND m.deleted = 0
      JOIN users u ON u.id = m.sender_id
      WHERE messages_fts MATCH ? AND messages_fts.conversation_id = ?
        AND NOT EXISTS (SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?)
        AND m.rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears WHERE user_id=? AND conversation_id=m.conversation_id), 0)
      ORDER BY m.created_at DESC LIMIT 30
    `).all(ftsQuery, convId, userId, userId);
  }

  // 写入缓存（TTL: 10 分钟）
  await cache.set(cacheKey, result, 600);

  return result;
}

// ── 跳转到指定消息的上下文（引用消息不在当前加载窗口时使用）──────
function aroundMessage(convId, msgId, userId) {
  requireMember(convId, userId);

  const clearClause = `AND m.rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears WHERE user_id=? AND conversation_id=m.conversation_id), 0
  )`;
  const userDelClause = `AND NOT EXISTS (
    SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?
  )`;

  const target = db.prepare(`
    SELECT created_at FROM messages
    WHERE id=? AND conversation_id=? AND deleted=0
    AND rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears WHERE user_id=? AND conversation_id=?), 0
    )
  `).get(msgId, convId, userId, convId);
  if (!target) return null;

  const HALF = 25;
  const before = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.conversation_id=? AND m.created_at<=? AND m.deleted=0 ${clearClause} ${userDelClause}
    ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?
  `).all(convId, target.created_at, userId, userId, HALF + 1);

  const after = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.conversation_id=? AND m.created_at>? AND m.deleted=0 ${clearClause} ${userDelClause}
    ORDER BY m.created_at ASC, m.rowid ASC LIMIT ?
  `).all(convId, target.created_at, userId, userId, HALF);

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
      AND m.rowid > COALESCE((SELECT cleared_rowid FROM conversation_clears
                                   WHERE user_id=? AND conversation_id=m.conversation_id), 0)
    ORDER BY m.created_at ASC, m.rowid ASC
    LIMIT 10000
  `).all(convId, userId);

  // 非文本消息的类型标注（transfer/red_packet 单独展开，见下方 formatBody）
  const typeLabel = {
    image: '[图片]', voice: '[语音]', video: '[视频]',
    file: '[文件]', sticker: '[表情包]',
    contact_card: '[名片]', nudge: '[拍一拍]', call: '[通话]',
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
    SELECT m.id, m.type, m.content, m.file_url, m.created_at, m.file_mime, m.file_size,
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
// 分页方式：offset → (created_at, msgId) 复合游标（见 AUDIT.md 第九节"分页方式"🟡）。
// 兼容策略：before/beforeId 都不传时走 offset 分支——首屏加载本来就不带任何分页参数，
// 不受影响；未升级的旧客户端会一直只传 offset，这条分支永久保留，旧客户端不会被这次
// 改动破坏，只是拿不到新分页方式修复的"翻页时插入/删除导致重复或漏读"这个问题，
// 直到客户端升级为止。不需要强制四端同步发版。
function getMentions(userId, { offset = 0, limit = 20, before, beforeId }) {
  const safeLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 50);

  // 查当前用户昵称（@提及用 @username 形式存在 content 里）
  const me = db.prepare('SELECT username FROM users WHERE id=?').get(userId);
  if (!me) return { items: [], total: 0, hasMore: false };

  const mention = '@' + me.username;

  const baseFrom = `
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    JOIN conversations c ON c.id = m.conversation_id
    JOIN conversation_members cm
         ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
    WHERE m.deleted = 0
      AND m.sender_id != ?
      AND instr(m.content, ?) > 0
  `;
  const baseParams = [userId, userId, mention];

  const beforeTs = Number(before);
  const useCursor = before != null && before !== '' && Number.isFinite(beforeTs);

  let rows;
  if (useCursor) {
    // 与 history() 同款复合游标：created_at 秒级精度，同一秒内多条 @我消息时
    // 仅用 created_at<before 会漏掉与游标同秒、排在上一页之后的消息；客户端回传
    // 上一页最后一条的 msgId 就能用 (created_at, rowid) 复合比较兜底，不丢不重。
    // rowid 查找限定在"当前用户是成员的会话"范围内，避免变成任意消息id是否存在的探测点。
    let beforeRowid = null;
    if (beforeId) {
      const r = db.prepare(`
        SELECT m.rowid AS rid FROM messages m
        JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
        WHERE m.id = ?
      `).get(userId, beforeId);
      if (r) beforeRowid = r.rid;
    }
    let cursorClause, cursorParams;
    if (beforeRowid != null) {
      cursorClause = 'AND (m.created_at < ? OR (m.created_at = ? AND m.rowid < ?))';
      cursorParams = [beforeTs, beforeTs, beforeRowid];
    } else {
      cursorClause = 'AND m.created_at < ?';
      cursorParams = [beforeTs];
    }
    // 多取 1 条用来判断 hasMore，不用"返回条数==limit"这种有边界误差的启发式。
    rows = db.prepare(`
      SELECT m.id, m.conversation_id, m.content, m.created_at, m.sender_id,
             u.username AS sender_name, c.name AS conv_name, c.type AS conv_type
      ${baseFrom} ${cursorClause}
      ORDER BY m.created_at DESC, m.rowid DESC
      LIMIT ?
    `).all(...baseParams, ...cursorParams, safeLimit + 1);
  } else {
    // 兼容分支：旧客户端 / 首屏加载（两者都不带 before）。
    const safeOffset = Math.max(parseInt(offset) || 0, 0);
    rows = db.prepare(`
      SELECT m.id, m.conversation_id, m.content, m.created_at, m.sender_id,
             u.username AS sender_name, c.name AS conv_name, c.type AS conv_type
      ${baseFrom}
      ORDER BY m.created_at DESC, m.rowid DESC
      LIMIT ? OFFSET ?
    `).all(...baseParams, safeLimit + 1, safeOffset);
  }

  const hasMore = rows.length > safeLimit;
  const page = hasMore ? rows.slice(0, safeLimit) : rows;

  // total 是旧客户端还在用的字段（Web端"共 X 条"标题），保留不删；游标翻页本身
  // 不依赖它，只是为了不破坏现有响应结构里已经有的字段。
  const { cnt: total } = db.prepare(`SELECT COUNT(*) AS cnt ${baseFrom}`).get(...baseParams);

  return {
    items: page.map(r => ({
      msgId:      r.id,
      convId:     r.conversation_id,
      convName:   r.conv_name || '私聊',
      convType:   r.conv_type,
      senderName: r.sender_name,
      content:    r.content.length > 120 ? r.content.slice(0, 120) + '…' : r.content,
      createdAt:  r.created_at,
    })),
    total,
    hasMore,
  };
}

module.exports = {
  history, missed, send, saveUploadedFile, forward, batchDelete,
  remove, react, edit, collect, searchGlobal, searchInConversation, aroundMessage,
  exportConversation, getConversationFiles, getMentions, adminRecall,
};
