'use strict';
/**
 * 消息域共享：成员校验、单条消息装配。
 * io 永远从 controller 经参数传入，service 层不直接引用 app。
 */
const { db, readDb } = require('../../db/connection');
const { forbidden } = require('../../utils/http');

// ── 热路径查询短 TTL 缓存（大群广播风暴防护：2000 连接高频消息时，
//    避免每条消息重复 4-5 次同步 SQLite 查询阻塞事件循环）─────────────
// 成员关系/会话/黑名单属低频变更数据，5s 缓存可接受（群增减员最多延迟 5s 生效）。
const CACHE_TTL_MS = 5000;
const memberCache = new Map();   // `${convId}|${userId}` → { role, t }
const convTypeCache = new Map(); // convId → { type, mute_all, t }
const blockedCache = new Map();  // `${uid}|${bid}` → { blocked, t }
const MAX_CACHE = 20000;

function cacheGet(map, key) {
  const v = map.get(key);
  if (!v) return undefined;
  if (Date.now() - v.t > CACHE_TTL_MS) { map.delete(key); return undefined; }
  return v;
}
function cacheSet(map, key, val) {
  if (map.size >= MAX_CACHE) map.clear(); // 简单防膨胀：超限整体清空
  map.set(key, { ...val, t: Date.now() });
}
// 变更后主动失效（加人/移人/拉黑/解黑调用）
function invalidateConv(convId) {
  for (const k of [...memberCache.keys()]) if (k.startsWith(convId + '|')) memberCache.delete(k);
  convTypeCache.delete(convId);
}
function invalidateBlocked(uid, bid) {
  blockedCache.delete(`${uid}|${bid}`);
  blockedCache.delete(`${bid}|${uid}`);
}

function isMember(convId, userId) {
  const key = `${convId}|${userId}`;
  const hit = cacheGet(memberCache, key);
  if (hit !== undefined) return hit.role !== null;
  const row = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, userId);
  cacheSet(memberCache, key, { role: row?.role ?? null });
  return !!row;
}

// 私聊发送统一守卫：合并「黑名单拦截」与「屏蔽陌生人」两道校验，覆盖全部发送路径
// （文本 HTTP/socket、文件/图片/语音/视频/表情、红包、拍一拍）。返回拒绝原因字符串；允许时返回 null。
//
// 性能：此前拆成 privateSendBlockReason + strangerBlockReason 两个函数，各自重查
// conversations.type 与「对方成员」，热路径每条私聊消息产生 2 次 conv 查询 + 2 次成员查询。
// 合并后仅查 1 次成员，且 conv 可由调用方（禁言校验时已取过）经参数传入省去 conv 查询。
//
// 读走 readDb（block()/settings 经 db 同步提交，此处立即可见）。群聊(type!=private)直接放行。
// @param conv 可选：调用方已查到的会话行，至少含 { type }。传入则省一次 conversations 查询。
function privateSendGuard(convId, senderId, conv = null) {
  const type = conv?.type ?? (cacheGet(convTypeCache, convId)?.type ?? readDb.prepare('SELECT type FROM conversations WHERE id=?').get(convId)?.type);
  if (conv && !convTypeCache.has(convId)) cacheSet(convTypeCache, convId, { type: conv.type, mute_all: conv.mute_all ?? 0 });
  if (type !== 'private') return null;

  const otherKey = `${convId}|__other__${senderId}`;
  const cachedOther = cacheGet(memberCache, otherKey);
  const other = cachedOther
    ? (cachedOther.user_id ? { user_id: cachedOther.user_id } : null)
    : readDb.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id!=?').get(convId, senderId);
  if (!cachedOther) cacheSet(memberCache, otherKey, { role: 'member', user_id: other?.user_id ?? null });
  if (!other) return null;
  const otherId = other.user_id;

  // 1) 黑名单：任一方已拉黑对方，则拒绝在既有会话内发消息（防止拉黑后仍被骚扰）
  const blKey = senderId < otherId ? `${senderId}|${otherId}` : `${otherId}|${senderId}`;
  let bl = cacheGet(blockedCache, blKey);
  if (bl === undefined) {
    bl = { blocked: readDb.prepare(
      'SELECT user_id FROM blocked_users WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)'
    ).all(senderId, otherId, otherId, senderId) };
    cacheSet(blockedCache, blKey, bl);
  }
  if (bl.blocked.length) {
    return bl.blocked.some(r => r.user_id === senderId)
      ? '你已将对方加入黑名单，移出后才能发送'
      : '消息已发出，但被对方拒收';
  }

  // 2) 屏蔽陌生人：对方开启该设置且发送者不在其联系人中则拒收。
  //    场景：双方曾是好友(会话已建)，对方删好友后开启屏蔽——旧会话仍在，
  //    须覆盖文件/图片等所有路径，否则陌生人可绕过文本拦截继续骚扰。
  const setting = readDb.prepare('SELECT block_unknown_messages FROM user_settings WHERE user_id=?').get(otherId);
  if (setting?.block_unknown_messages) {
    const isFriend = readDb.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(otherId, senderId);
    if (!isFriend) return '对方已开启屏蔽陌生人消息';
  }

  return null;
}

function requireMember(convId, userId, msg = '无权访问') {
  if (!isMember(convId, userId)) throw forbidden(msg);
}

function memberRole(convId, userId) {
  const key = `${convId}|${userId}`;
  const hit = cacheGet(memberCache, key);
  if (hit !== undefined) return hit.role;
  const role = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, userId)?.role || null;
  cacheSet(memberCache, key, { role });
  return role;
}

// 装配单条消息（含 replyTo + reactions），用于 HTTP 发送/转发等单条返回
function buildMessage(id) {
  const msg = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?
  `).get(id);
  if (!msg) return null;

  if (msg.reply_to_id) {
    msg.replyTo = db.prepare(`
      SELECT m.id, m.type, m.content, m.file_url, m.deleted, u.username as senderName
      FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=? AND m.conversation_id=?
    `).get(msg.reply_to_id, msg.conversation_id) || null;
  }
  const reactions = db.prepare(`
    SELECT emoji, GROUP_CONCAT(user_id) as userIds, COUNT(*) as count
    FROM message_reactions WHERE message_id=? GROUP BY emoji
  `).all(id);
  msg.reactions = reactions.map(r => ({ emoji: r.emoji, count: r.count, userIds: r.userIds.split(',') }));
  return msg;
}

// 彻底清除一个会话及其全部衍生数据（消息/表情/送达/FTS/置顶/红包/成员/设置/邀请令牌）。
// 必须按外键依赖顺序删除，否则 foreign_keys=ON 下删 conversations 会约束失败。
function purgeConversation(id) {
  db.transaction(() => {
    // P1-05 洞 B（独立解散路径）：admin dismissGroup 与用户侧 dissolve 都经此函数
    // 删除会话。删红包前必须先结算本会话全部在途红包（含已退群成员发出的），
    // 剩余金额原路退回各自 sender；否则直接 DELETE 会凭空销毁他人资金。
    // 延迟 require 避免循环依赖（redpackets.service 顶层依赖本模块）。
    const redpackets = require('../redpackets/redpackets.service');
    redpackets.settleConversationPacketsTx(id);
    const msgIds = db.prepare('SELECT id FROM messages WHERE conversation_id=?').all(id).map(r => r.id);
    if (msgIds.length) {
      const ph = msgIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM message_reactions WHERE message_id IN (${ph})`).run(...msgIds);
      db.prepare(`DELETE FROM message_deliveries WHERE message_id IN (${ph})`).run(...msgIds);
      db.prepare(`DELETE FROM messages_fts WHERE message_id IN (${ph})`).run(...msgIds);
    }
    db.prepare('DELETE FROM pinned_messages WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM red_packet_claims WHERE packet_id IN (SELECT id FROM red_packets WHERE conversation_id=?)').run(id);
    db.prepare('DELETE FROM red_packets WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM messages WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM conversation_settings WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM group_invite_tokens WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM conversation_members WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM conversations WHERE id=?').run(id);
  })();
}

module.exports = { isMember, requireMember, memberRole, buildMessage, purgeConversation, privateSendGuard };
