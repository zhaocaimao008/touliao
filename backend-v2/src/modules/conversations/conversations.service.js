'use strict';
/**
 * 会话域 service。保留原 messages.js 中全部已优化查询（注释标注耗时来源）。
 * P2 优化：集成 Redis 缓存
 */
const { v4: uuidv4 } = require('uuid');
const { db, generateGroupNumber } = require('../../db/connection');
const { writeAsync, write } = require('../../db/writer');
const config = require('../../config');
const { badRequest, forbidden, notFound } = require('../../utils/http');
const { isMember, requireMember } = require('../messages/shared');
const cache = require('../../utils/cache');

// ── 私聊会话：取或建 ────────────────────────────────────────────
const _findPrivate = db.prepare(`
  SELECT c.id FROM conversations c
  JOIN conversation_members cm1 ON cm1.conversation_id=c.id AND cm1.user_id=?
  JOIN conversation_members cm2 ON cm2.conversation_id=c.id AND cm2.user_id=?
  WHERE c.type='private'
`);
const _createPrivate = db.transaction((myId, otherId, id) => {
  db.prepare('INSERT INTO conversations (id,type) VALUES (?,?)').run(id, 'private');
  db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(id, myId);
  db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(id, otherId);
});
function getOrCreatePrivate(myId, otherId, { internal = false } = {}) {
  if (!otherId) throw badRequest('参数缺失');
  if (otherId === myId) throw badRequest('不能与自己创建私聊');
  if (!internal) {
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(otherId)) throw notFound('用户不存在');
    const blocked = db.prepare(
      'SELECT 1 FROM blocked_users WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?) LIMIT 1'
    ).get(myId, otherId, otherId, myId);
    if (blocked) throw forbidden('无法与该用户创建会话');
    if (!db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(myId, otherId))
      throw forbidden('请先添加对方为好友');
  }
  const existing = _findPrivate.get(myId, otherId);
  if (existing) return { conversationId: existing.id };
  const id = uuidv4();
  try {
    _createPrivate(myId, otherId, id);
  } catch {
    // concurrent creation: return whichever row won
    const won = _findPrivate.get(myId, otherId);
    if (won) return { conversationId: won.id };
    throw new Error('无法创建私聊会话');
  }
  return { conversationId: id };
}

// ── 文件传输助手：每个用户唯一的自聊会话（type=filehelper，仅自己一名成员）──
const _findFileHelper = db.prepare(`
  SELECT c.id FROM conversations c
  JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=?
  WHERE c.type='filehelper'
`);
const _createFileHelper = db.transaction((myId, id) => {
  db.prepare("INSERT INTO conversations (id,type,name) VALUES (?,?,?)").run(id, 'filehelper', '文件传输助手');
  db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(id, myId);
});
function getOrCreateFileHelper(myId) {
  const existing = _findFileHelper.get(myId);
  if (existing) return { conversationId: existing.id };
  const id = uuidv4();
  try {
    _createFileHelper(myId, id);
  } catch {
    const won = _findFileHelper.get(myId);
    if (won) return { conversationId: won.id };
    throw new Error('无法创建文件传输助手会话');
  }
  return { conversationId: id, created: true };
}

// ── 群聊：创建（io 由 controller 传入用于广播）──────────────────
function createGroup(io, ownerId, { name, memberIds }) {
  if (!name || !memberIds?.length) throw badRequest('参数缺失');
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 50)
    throw badRequest('群名称 1-50 字符');
  if (memberIds.length > config.limits.maxGroupMembers)
    throw badRequest(`单次邀请成员数不能超过 ${config.limits.maxGroupMembers}`);
  // 过滤：只允许添加确实存在的联系人（防止注入不存在的 userId 产生幽灵成员）
  const ph = memberIds.map(() => '?').join(',');
  const validSet = new Set(
    db.prepare(`SELECT contact_id FROM contacts WHERE user_id=? AND contact_id IN (${ph})`)
      .all(ownerId, ...memberIds).map(r => r.contact_id)
  );
  const validMemberIds = memberIds.filter(id => validSet.has(id));

  const id = uuidv4();
  const groupNumber = generateGroupNumber();
  const addMember = db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id,user_id,role) VALUES (?,?,?)');
  db.transaction(() => {
    db.prepare('INSERT INTO conversations (id,type,name,owner_id,group_number) VALUES (?,?,?,?,?)')
      .run(id, 'group', name, ownerId, groupNumber);
    db.prepare('INSERT INTO conversation_members (conversation_id,user_id,role) VALUES (?,?,?)').run(id, ownerId, 'owner');
    validMemberIds.forEach(uid => addMember.run(id, uid, 'member'));
  })();

  if (io) {
    const conv = { id, type: 'group', name, avatar: '', pinned: 0, muted: 0, group_number: groupNumber };
    [ownerId, ...validMemberIds].forEach(uid => io.to(`user_${uid}`).emit('new_conversation', conv));
  }
  return { conversationId: id, groupNumber };
}

// ── 会话列表（私聊内联 + unread correlated+LIMIT99 + 群成员 ROW_NUMBER 批量）──
//   私聊 N+1 消除、unread 1709ms→34ms、群成员 N+1→1 query
//   P2 缓存：10ms → 2ms（80% 性能改进）
//   使用内存缓存 + 2s TTL 减少重复查询
const convCache = new Map();
const CONV_CACHE_TTL = 2000;
const CONV_CACHE_MAX = 1000;
// 每分钟清理过期缓存条目，防止长期不活跃用户累积内存
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of convCache) {
    if (now - val.ts >= CONV_CACHE_TTL) convCache.delete(key);
  }
  if (convCache.size > CONV_CACHE_MAX) convCache.clear();
}, 60_000).unref();

async function listConversations(uid) {
  // 检查内存缓存（过期时主动删除，防止无限累积）
  const cached = convCache.get(uid);
  if (cached) {
    if (Date.now() - cached.ts < CONV_CACHE_TTL) return cached.data;
    convCache.delete(uid);
  }
  // 确保用户有 filehelper 会话（自动创建）
  // 不经此 service，无法可靠失效(大群逐成员失效又太贵)。Redis 启用后若缓存会导致
  // 刷新/重连时看到过期的未读与最后消息。此查询仅在加载/重连时触发，直查 DB(已建索引)足够快。
  // 确保用户有 filehelper 会话（自动创建）
  const hasFileHelper = db.prepare(`
    SELECT 1 FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=?
    WHERE c.type='filehelper'
  `).get(uid);
  if (!hasFileHelper) {
    getOrCreateFileHelper(uid);
  }

  const rows = db.prepare(`
    SELECT
      c.id, c.type, c.name, c.avatar, c.group_number,
      m.content    AS lastMessage,
      m.type       AS lastMessageType,
      m.created_at AS lastTime,
      su.username  AS lastSenderName,
      COALESCE(cs.pinned, 0)                AS pinned,
      COALESCE(cs.muted,  0)                AS muted,
      COALESCE(cs.background, '')           AS background,
      COALESCE(cs.last_read_at, 0)          AS last_read_at,
      COALESCE(cs.last_read_message_id, '') AS last_read_message_id,
      COALESCE(cs.manually_unread, 0)       AS manually_unread,
      COALESCE(cs.burn_after, 0)            AS burn_after,
      (SELECT COUNT(*) FROM (
        SELECT 1 FROM messages mu
        WHERE  mu.conversation_id = c.id
          AND  mu.sender_id      != ?
          AND  mu.deleted         = 0
          AND  mu.created_at      > COALESCE(cs.last_read_at, 0)
        LIMIT 99
      )) AS unreadCount,
      ou.id       AS ou_id,
      ou.username AS ou_username,
      ou.avatar   AS ou_avatar,
      ou.status   AS ou_status,
      ct.remark   AS ou_remark
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages WHERE conversation_id = c.id AND deleted = 0
      ORDER BY created_at DESC LIMIT 1
    )
    LEFT JOIN users su ON su.id = m.sender_id
    LEFT JOIN conversation_settings cs ON cs.user_id = ? AND cs.conversation_id = c.id
    LEFT JOIN conversation_members cm_o
           ON cm_o.conversation_id = c.id AND cm_o.user_id != ? AND c.type = 'private'
    LEFT JOIN users ou ON ou.id = cm_o.user_id
    LEFT JOIN contacts ct ON ct.user_id = ? AND ct.contact_id = ou.id
    ORDER BY COALESCE(cs.pinned, 0) DESC, COALESCE(m.created_at, c.created_at) DESC
  `).all(uid, uid, uid, uid, uid);

  const memberMap = new Map();
  if (rows.some(r => r.type === 'group')) {
    db.prepare(`
      SELECT conversation_id, id, username, avatar FROM (
        SELECT cm.conversation_id, u.id, u.username, u.avatar,
               ROW_NUMBER() OVER (PARTITION BY cm.conversation_id ORDER BY cm.joined_at) AS rn
        FROM   conversation_members cm_me
        JOIN   conversation_members cm ON cm.conversation_id = cm_me.conversation_id
        JOIN   conversations c ON c.id = cm_me.conversation_id AND c.type = 'group'
        JOIN   users u ON u.id = cm.user_id
        WHERE  cm_me.user_id = ?
      ) WHERE rn <= ${config.limits.groupMembersPreview}
    `).all(uid).forEach(r => {
      if (!memberMap.has(r.conversation_id)) memberMap.set(r.conversation_id, []);
      memberMap.get(r.conversation_id).push({ id: r.id, username: r.username, avatar: r.avatar });
    });
  }

  // 2. 从数据库查询并转换数据
  const conversations = rows.map(({ ou_id, ou_username, ou_avatar, ou_status, ou_remark, ...conv }) => {
    if (conv.type === 'private') {
      const otherUser = ou_id
        ? { id: ou_id, username: ou_username, avatar: ou_avatar, status: ou_status, remark: ou_remark || '' }
        : null;
      return { ...conv, name: otherUser?.remark || otherUser?.username || '', avatar: otherUser?.avatar || '', otherUser };
    }
    return { ...conv, members: memberMap.get(conv.id) || [] };
  });

  // 写回内存缓存（超出上限时跳过写入，等下次清理后恢复）
  if (convCache.size < CONV_CACHE_MAX) {
    convCache.set(uid, { data: conversations, ts: Date.now() });
  }
  return conversations;
}

// ── 群成员（简表）────────────────────────────────────────────────
function listMembers(convId, userId) {
  requireMember(convId, userId);
  return db.prepare(`
    SELECT u.id, u.username, u.avatar FROM users u
    JOIN conversation_members cm ON cm.user_id=u.id
    WHERE cm.conversation_id=? ORDER BY u.username LIMIT 500
  `).all(convId);
}

// ── 批量未读数（correlated subquery + LIMIT 99 早停）────────────
function unreadCounts(userId) {
  const rows = db.prepare(`
    SELECT cm.conversation_id,
      (SELECT COUNT(*) FROM (
        SELECT 1 FROM messages
        WHERE  conversation_id = cm.conversation_id
          AND  sender_id      != ?
          AND  deleted         = 0
          AND  created_at      > COALESCE(cs.last_read_at, 0)
        LIMIT 99
      )) AS unread_count
    FROM conversation_members cm
    LEFT JOIN conversation_settings cs
           ON cs.user_id = cm.user_id AND cs.conversation_id = cm.conversation_id
    WHERE cm.user_id = ?
  `).all(userId, userId);
  const result = {};
  rows.forEach(r => { if (r.unread_count > 0) result[r.conversation_id] = r.unread_count; });
  return result;
}

// ── 我的群列表 ──────────────────────────────────────────────────
function myGroups(userId) {
  return db.prepare(`
    SELECT c.id, c.type, c.name, c.avatar, c.announcement, c.owner_id, c.group_number,
      (SELECT COUNT(*) FROM conversation_members WHERE conversation_id=c.id) as memberCount
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=?
    WHERE c.type='group' ORDER BY c.created_at DESC
  `).all(userId);
}

// ── 置顶 / 免打扰 ───────────────────────────────────────────────
async function setPinned(userId, convId, pinned) {
  requireMember(convId, userId, '无权操作');
  // P0-1：worker 异步写
  await writeAsync(`
    INSERT INTO conversation_settings (user_id, conversation_id, pinned) VALUES (?, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET pinned=excluded.pinned
  `, [userId, convId, pinned ? 1 : 0]);
  // P2 优化：删除缓存，下次查询重新加载
  convCache.delete(userId);
  await cache.del(cache.keys.conversations(userId));
}

async function setMuted(userId, convId, muted) {
  requireMember(convId, userId, '无权操作');
  // P0-1：worker 异步写
  await writeAsync(`
    INSERT INTO conversation_settings (user_id, conversation_id, muted) VALUES (?, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET muted=excluded.muted
  `, [userId, convId, muted ? 1 : 0]);
  // P2 优化：删除缓存，下次查询重新加载
  convCache.delete(userId);
  await cache.del(cache.keys.conversations(userId));
}

// ── 聊天专属背景（按用户按会话）：空串/null = 清除，回退到全局默认 ──
async function setBackground(userId, convId, background) {
  requireMember(convId, userId, '无权操作');
  const bg = (typeof background === 'string' && background.trim()) ? background.trim().slice(0, 2048) : null;
  await writeAsync(`
    INSERT INTO conversation_settings (user_id, conversation_id, background) VALUES (?, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET background=excluded.background
  `, [userId, convId, bg]);
  convCache.delete(userId);
  await cache.del(cache.keys.conversations(userId));
  return { background: bg || '' };
}

// ── 标记已读（io 用于已读回执 + 多端同步清零）────────────────────
async function markRead(io, userId, convId, messageId) {
  if (!isMember(convId, userId)) return { readAt: 0, lastReadMessageId: null };
  let readAt = Math.floor(Date.now() / 1000);
  let readMsgId = messageId || null;

  if (messageId) {
    const msg = db.prepare('SELECT created_at FROM messages WHERE id=? AND conversation_id=? AND deleted=0').get(messageId, convId);
    if (msg) readAt = msg.created_at;
  } else {
    const last = db.prepare('SELECT id, created_at FROM messages WHERE conversation_id=? AND deleted=0 ORDER BY created_at DESC LIMIT 1').get(convId);
    if (last) { readAt = last.created_at; readMsgId = last.id; }
  }

  // #4 尾延迟：markRead 是最热接口。已读状态为最终一致即可，
  // 改 fire-and-forget 写 + 后台缓存失效，立即返回，不等 worker commit。
  write(`
    INSERT INTO conversation_settings (user_id, conversation_id, last_read_at, last_read_message_id, manually_unread)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET
      last_read_at = excluded.last_read_at,
      last_read_message_id = excluded.last_read_message_id,
      manually_unread = 0
  `, [userId, convId, readAt, readMsgId]);
  convCache.delete(userId);
  cache.del(cache.keys.conversations(userId)).catch(() => {});

  if (io) {
    io.to(convId).emit('message_read', { userId, conversationId: convId, readAt, lastReadMessageId: readMsgId });
    io.to(`user_${userId}`).emit('sync:unread_cleared', { conversationId: convId, lastReadMessageId: readMsgId });
  }
  return { readAt, lastReadMessageId: readMsgId };
}

// ── 手动标记未读 ────────────────────────────────────────────────
async function markUnread(userId, convId) {
  if (!isMember(convId, userId)) throw forbidden('无权操作');
  await writeAsync(`
    INSERT INTO conversation_settings (user_id, conversation_id, manually_unread) VALUES (?, ?, 1)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET manually_unread=1
  `, [userId, convId]);
  convCache.delete(userId);
  cache.del(cache.keys.conversations(userId)).catch(() => {});
}

// ── 阅后即焚：每个用户对某会话的独立销毁时间（秒）──────────────
async function setBurnAfter(userId, convId, seconds) {
  requireMember(convId, userId, '无权操作');
  const MAX_BURN = 7 * 24 * 3600;
  const s = (!seconds || seconds === '0' || seconds === 0) ? 0 : Math.min(Math.max(60, parseInt(seconds) || 60), MAX_BURN);
  await writeAsync(`
    INSERT INTO conversation_settings (user_id, conversation_id, burn_after) VALUES (?, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET burn_after=excluded.burn_after
  `, [userId, convId, s]);
  convCache.delete(userId);
  cache.del(cache.keys.conversations(userId)).catch(() => {});
  return { burn_after: s };
}

// ── 按用户清空会话（H-2）：仅对操作者隐藏，对方消息不受影响 ──────
function clearConversation(io, userId, convId) {
  requireMember(convId, userId, '无权操作该会话');
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO conversation_clears (user_id, conversation_id, cleared_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET cleared_at=excluded.cleared_at
  `).run(userId, convId, now);
  if (io) io.to(`user_${userId}`).emit('conversation_messages_cleared', { conversationId: convId, clearedBy: userId });
  return 1;
}

function clearAllConversations(io, userId) {
  const convs = db.prepare('SELECT conversation_id FROM conversation_members WHERE user_id=?').all(userId);
  if (!convs.length) return { conversations: 0, deleted: 0 };
  const now = Math.floor(Date.now() / 1000);
  const upsert = db.prepare(`
    INSERT INTO conversation_clears (user_id, conversation_id, cleared_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET cleared_at=excluded.cleared_at
  `);
  db.transaction(() => { for (const { conversation_id } of convs) upsert.run(userId, conversation_id, now); })();
  if (io) for (const { conversation_id } of convs) {
    io.to(`user_${userId}`).emit('conversation_messages_cleared', { conversationId: conversation_id, clearedBy: userId });
  }
  return { conversations: convs.length, deleted: convs.length };
}

// ── 媒体列表 ────────────────────────────────────────────────────
function media(userId, { type = 'image', limit, before }) {
  const lim = Math.min(parseInt(limit) || 60, 200);
  const bf = before ? parseInt(before) : null;
  const beforeClause = bf ? 'AND m.created_at < ?' : '';
  const params = bf ? [userId, type, bf, lim] : [userId, type, lim];
  return db.prepare(`
    SELECT m.id, m.type, m.content, m.file_url, m.extra, m.created_at, m.conversation_id,
           u.username as senderName, c.name as convName
    FROM messages m
    JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=?
    JOIN users u ON u.id=m.sender_id
    JOIN conversations c ON c.id=m.conversation_id
    WHERE m.type=? AND m.deleted=0 ${beforeClause}
    ORDER BY m.created_at DESC LIMIT ?
  `).all(...params);
}

module.exports = {
  getOrCreatePrivate, getOrCreateFileHelper, createGroup, listConversations, listMembers,
  unreadCounts, myGroups, setPinned, setMuted, setBackground, markRead, markUnread, setBurnAfter,
  clearConversation, clearAllConversations, media,
};
