'use strict';
const { db } = require('../../db/connection');
const { notFound, badRequest, conflict, paginated } = require('../../utils/http');
const cache = require('../../utils/cache');
const { v4: uuidv4 } = require('uuid');
const { collectionDedupKey } = require('../../utils/collections');
const presence = require('../../realtime/presence');

// ── 设置序列化 ──────────────────────────────────────────────────
const settingDefaults = {
  add_by_vxin_id: 1, add_by_phone: 1, require_verify: 1, profile_visible: 1,
  block_unknown_messages: 0, message_notify: 1, detail_preview: 1, sound: 1, vibrate: 0,
  chat_background: null, moments_visible_days: 0,
};
const toBool = v => !!Number(v);
const toIntBool = v => (v ? 1 : 0);
// 朋友圈"最近 N 天可见"允许的取值：0=全部 / 1=今天 / 3=三天 / 30=半年
const MOMENTS_DAY_OPTIONS = [0, 1, 3, 30];

function ensureSettings(userId) {
  db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM user_settings WHERE user_id=?').get(userId);
}

function serializeSettings(row) {
  const s = { ...settingDefaults, ...(row || {}) };
  return {
    addByVxinId: toBool(s.add_by_vxin_id), addByPhone: toBool(s.add_by_phone),
    requireVerify: toBool(s.require_verify), profileVisible: toBool(s.profile_visible),
    blockUnknownMessages: toBool(s.block_unknown_messages), messageNotify: toBool(s.message_notify),
    detailPreview: toBool(s.detail_preview), sound: toBool(s.sound), vibrate: toBool(s.vibrate),
    chatBackground: s.chat_background || '', momentsVisibleDays: Number(s.moments_visible_days) || 0,
  };
}

function normalizeSettings(body) {
  const map = {
    addByVxinId: 'add_by_vxin_id', addByPhone: 'add_by_phone', requireVerify: 'require_verify',
    profileVisible: 'profile_visible', blockUnknownMessages: 'block_unknown_messages',
    messageNotify: 'message_notify', detailPreview: 'detail_preview', sound: 'sound', vibrate: 'vibrate',
  };
  const patch = {};
  for (const [k, dbKey] of Object.entries(map)) {
    if (body[k] !== undefined) patch[dbKey] = toIntBool(body[k]);
  }
  // 非布尔字段：全局默认聊天背景（字符串/清空）与朋友圈可见天数（枚举）
  if (body.chatBackground !== undefined) {
    const bg = typeof body.chatBackground === 'string' ? body.chatBackground.trim().slice(0, 2048) : '';
    patch.chat_background = bg || null;
  }
  if (body.momentsVisibleDays !== undefined) {
    const d = Number(body.momentsVisibleDays);
    patch.moments_visible_days = MOMENTS_DAY_OPTIONS.includes(d) ? d : 0;
  }
  return patch;
}

function getSettings(userId) {
  return serializeSettings(ensureSettings(userId));
}

function updateSettings(userId, body) {
  ensureSettings(userId);
  const patch = normalizeSettings(body || {});
  if (Object.keys(patch).length) {
    const assignments = Object.keys(patch).map(k => `${k}=?`).join(',');
    const values = [...Object.values(patch), Math.floor(Date.now() / 1000), userId];
    db.prepare(`UPDATE user_settings SET ${assignments}, updated_at=? WHERE user_id=?`).run(...values);
  }
  return serializeSettings(ensureSettings(userId));
}

// ── 二维码 payload ──────────────────────────────────────────────
function qrPayload(userId) {
  const user = db.prepare('SELECT id,wechat_id FROM users WHERE id=?').get(userId);
  if (!user) throw notFound('用户不存在');
  return JSON.stringify({ type: 'vxin-user', id: user.id, vxinId: user.wechat_id });
}

// ── 搜索 ────────────────────────────────────────────────────────
// 隐私：不返回 phone 字段（本 session S3 修复保留）；
// 也不返回 bio——getUserDetail 对「非好友且 profile_visible=0」会隐藏 bio，
// 搜索若照返 bio 就等于绕过资料可见性泄露签名。前端搜索结果只用 username/avatar/wechat_id。
function search(userId, q) {
  if (!q) return [];
  if (q.length > 50) throw badRequest('搜索内容过长');
  const like = '%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%';
  return db.prepare(`
    SELECT u.id, u.username, u.avatar, u.wechat_id
    FROM users u
    LEFT JOIN user_settings s ON s.user_id = u.id
    WHERE u.id != ?
      AND (
        u.username LIKE ? ESCAPE '\\'
        OR (u.wechat_id = ? AND COALESCE(s.add_by_vxin_id, 1) = 1)
        OR (u.phone = ? AND COALESCE(s.add_by_phone, 1) = 1)
      )
    LIMIT 20
  `).all(userId, like, q, q);
}

// ── 资料 ────────────────────────────────────────────────────────
async function updateProfile(userId, { username, bio }) {
  if (username) {
    if (typeof username !== 'string' || username.trim().length < 1 || username.trim().length > 30)
      throw badRequest('用户名长度为 1-30 字符');
    if (db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(username.trim(), userId))
      throw badRequest('用户名已被占用');
    try {
      db.prepare('UPDATE users SET username=? WHERE id=?').run(username.trim(), userId);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw badRequest('用户名已被占用');
      throw e;
    }
  }
  if (bio !== undefined) {
    const safeBio = typeof bio === 'string' ? bio.slice(0, 500) : '';
    db.prepare('UPDATE users SET bio=? WHERE id=?').run(safeBio, userId);
  }
  await cache.del(cache.keys.user(userId));
  presence.dropProfile(userId); // 刷新在线状态中的昵称缓存，避免发消息时仍用旧名字
  return db.prepare('SELECT id,username,avatar,bio,wechat_id,cover_photo FROM users WHERE id=?').get(userId);
}

async function setAvatar(userId, url) {
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(url, userId);
  await cache.del(cache.keys.user(userId));
  presence.dropProfile(userId);
}

async function setCover(userId, url) {
  db.prepare('UPDATE users SET cover_photo=? WHERE id=?').run(url, userId);
  // P2 优化：删除缓存
  await cache.del(cache.keys.user(userId));
}

// ── 用户详情（隐私可见性判定）──────────────────────────────────
async function getUserDetail(viewerId, targetId) {
  // P2 优化：尝试从缓存获取用户基本信息（TTL: 30 分钟）
  const cacheKey = cache.keys.user(targetId);
  let user = await cache.get(cacheKey);

  if (!user) {
    // 缓存未命中，从数据库查询
    user = db.prepare('SELECT id,username,avatar,bio,status,wechat_id,cover_photo FROM users WHERE id=?').get(targetId);
    if (!user) throw notFound('用户不存在');
    // 写入缓存
    await cache.set(cacheKey, user, 1800);
  }

  // 关系信息不缓存（每次实时查询）
  const contact   = db.prepare('SELECT remark FROM contacts WHERE user_id=? AND contact_id=?').get(viewerId, targetId);
  const isFriend  = !!contact;
  const isBlocked = !!db.prepare('SELECT 1 FROM blocked_users WHERE user_id=? AND blocked_id=?').get(viewerId, targetId);
  const settings  = serializeSettings(ensureSettings(targetId));
  const visible   = isFriend || targetId === viewerId || settings.profileVisible;
  const pendingReq = db.prepare('SELECT id FROM friend_requests WHERE from_id=? AND to_id=? AND status=?').get(viewerId, targetId, 'pending');
  return {
    ...user,
    bio: visible ? user.bio : '',
    cover_photo: visible ? user.cover_photo : '',
    isFriend, isBlocked,
    remark: contact?.remark || '',
    hasPendingRequest: !!pendingReq,
  };
}

// ── 收藏 ────────────────────────────────────────────────────────
// CO2：支持 type 过滤 + limit/offset 分页。无 limit 时维持「返回全部」（向后兼容，仍裸数组）
function getCollections(userId, { type, limit, offset } = {}) {
  const conds = ['user_id=?'];
  const params = [userId];
  if (type && ['text', 'image', 'file', 'video'].includes(type)) { conds.push('type=?'); params.push(type); }
  const lim = Math.min(Math.max(parseInt(limit) || 100, 1), 100);
  const off = Math.max(parseInt(offset) || 0, 0);
  let sql = `SELECT * FROM collections WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(lim, off);
  return db.prepare(sql).all(...params).map(i => ({ ...i, extra: JSON.parse(i.extra || '{}') }));
}

// 添加收藏（去重：同一 user + 类型 + 内容标识 不重复收藏，重复返回 409）
// CO3：返回新建的收藏对象（保留 success 向后兼容）
function addCollection(userId, { type, content, extra }) {
  const userCount = db.prepare('SELECT COUNT(*) n FROM collections WHERE user_id=?').get(userId).n;
  if (userCount >= 1000) throw badRequest('收藏已达上限 1000 条');
  const safeType    = ['text', 'image', 'file', 'video'].includes(type) ? type : 'text';
  const safeContent = (typeof content === 'string' ? content : JSON.stringify(content)).slice(0, 2000);
  const safeExtra   = extra && typeof extra === 'object' ? extra : {};
  const dedupKey    = collectionDedupKey(safeType, safeContent, safeExtra);

  const existing = db.prepare('SELECT id FROM collections WHERE user_id=? AND dedup_key=?').get(userId, dedupKey);
  if (existing) throw conflict('已收藏', 'COLLECTION_DUPLICATE');

  const id = uuidv4();
  const res = db.prepare('INSERT OR IGNORE INTO collections (id,user_id,type,content,extra,dedup_key) VALUES (?,?,?,?,?,?)')
    .run(id, userId, safeType, safeContent, JSON.stringify(safeExtra), dedupKey);
  if (res.changes === 0) throw conflict('已收藏', 'COLLECTION_DUPLICATE');
  const row = db.prepare('SELECT * FROM collections WHERE id=?').get(id);
  return { success: true, ...row, extra: JSON.parse(row.extra || '{}') };
}

// CO6：收藏搜索（按 content 模糊匹配，可选 type 过滤），返回 { items, total, hasMore }
// 注：放在 getCollection 之前定义无所谓，路由层须保证 /search 在 /:id 之前注册
function searchCollections(userId, { q, type, limit = 20, offset = 0 } = {}) {
  const kw = (typeof q === 'string' ? q : '').trim();
  const lim = Math.min(Math.max(parseInt(limit) || 20, 1), 50);
  const off = Math.max(parseInt(offset) || 0, 0);
  if (!kw) return paginated([], { total: 0, limit: lim, offset: off });

  const conds = ['user_id=?', 'content LIKE ? ESCAPE \'\\\''];
  const like = `%${kw.replace(/[\\%_]/g, c => '\\' + c)}%`; // 转义 LIKE 通配符
  const params = [userId, like];
  if (type && ['text', 'image', 'file', 'video'].includes(type)) { conds.push('type=?'); params.push(type); }
  const where = conds.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) AS n FROM collections WHERE ${where}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM collections WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, lim, off)
    .map(i => ({ ...i, extra: JSON.parse(i.extra || '{}') }));
  return paginated(rows, { total, limit: lim, offset: off });
}

// CO5：单条收藏详情（仅本人）
function getCollection(userId, collectionId) {
  const row = db.prepare('SELECT * FROM collections WHERE id=? AND user_id=?').get(collectionId, userId);
  if (!row) throw notFound('收藏不存在');
  return { ...row, extra: JSON.parse(row.extra || '{}') };
}

// 取消收藏（仅能删自己的，幂等：不存在则报 404）
function removeCollection(userId, collectionId) {
  const r = db.prepare('DELETE FROM collections WHERE id=? AND user_id=?').run(collectionId, userId);
  if (r.changes === 0) throw notFound('收藏不存在');
  return { success: true };
}

// 通话历史（自己作为主叫或被叫的记录，含对方资料 + 方向）
function getCallLogs(userId, limit = 50) {
  const n = Math.min(Number(limit) || 50, 200);
  return db.prepare(`
    SELECT cl.id, cl.type, cl.status, cl.started_at, cl.ended_at, cl.duration, cl.created_at,
           CASE WHEN cl.caller_id=? THEN 'out' ELSE 'in' END AS direction,
           CASE WHEN cl.caller_id=? THEN cl.callee_id ELSE cl.caller_id END AS peer_id,
           pu.username AS peer_name, pu.avatar AS peer_avatar
    FROM call_logs cl
    JOIN users pu ON pu.id = (CASE WHEN cl.caller_id=? THEN cl.callee_id ELSE cl.caller_id END)
    WHERE cl.caller_id=? OR cl.callee_id=?
    ORDER BY cl.created_at DESC
    LIMIT ?
  `).all(userId, userId, userId, userId, userId, n);
}

module.exports = {
  ensureSettings, serializeSettings, getSettings, updateSettings,
  qrPayload, search, updateProfile, setAvatar, setCover,
  getUserDetail, getCollections, addCollection, removeCollection, getCallLogs,
  searchCollections, getCollection,
};
