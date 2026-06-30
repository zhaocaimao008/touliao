'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../../config');
const { db } = require('../../db/connection');
const { badRequest, notFound, unauthorized } = require('../../utils/http');
const { purgeConversation } = require('../messages/shared');
const moments = require('../moments/moments.service');
const wallet = require('../wallet/wallet.service');

// ── 凭证校验（恒定时间比较，防时序侧信道）──────────────────────
function timingSafeEqual(a, b) {
  const ba = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyCredentials(username, password) {
  if (!config.admin.username || !config.admin.password) {
    throw badRequest('后台未配置：请在 .env 设置 ADMIN_USERNAME / ADMIN_PASSWORD');
  }
  const okUser = timingSafeEqual(username, config.admin.username);
  const okPass = timingSafeEqual(password, config.admin.password);
  if (!okUser || !okPass) throw unauthorized('账号或密码错误');
  return true;
}

// ── 数据总览 ────────────────────────────────────────────────────
function stats(onlineCount) {
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  const one = sql => db.prepare(sql);
  return {
    users:         one('SELECT COUNT(*) n FROM users').get().n,
    usersBanned:   one('SELECT COUNT(*) n FROM users WHERE banned=1').get().n,
    usersToday:    one('SELECT COUNT(*) n FROM users WHERE created_at > ?').get(dayAgo).n,
    online:        onlineCount,
    messages:      one('SELECT COUNT(*) n FROM messages WHERE deleted=0').get().n,
    messagesToday: one('SELECT COUNT(*) n FROM messages WHERE deleted=0 AND created_at > ?').get(dayAgo).n,
    conversations: one("SELECT COUNT(*) n FROM conversations").get().n,
    groups:        one("SELECT COUNT(*) n FROM conversations WHERE type='group'").get().n,
    redPackets:    one('SELECT COUNT(*) n FROM red_packets').get().n,
  };
}

// ── 用户列表（搜索 + 分页）──────────────────────────────────────
const escapeLike = s => s.replace(/[%_\\]/g, c => '\\' + c);

function listUsers({ q, limit = 30, offset = 0, banned, period, online }) {
  const lim = Math.min(parseInt(limit) || 30, 100);
  const off = Math.max(parseInt(offset) || 0, 0);
  const like = q ? `%${escapeLike(q)}%` : null;
  const truthy = v => v === '1' || v === 1 || v === true;

  const conds = [], args = [];
  if (q) { conds.push("(u.username LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.wechat_id LIKE ? ESCAPE '\\')"); args.push(like, like, like); }
  if (truthy(banned)) conds.push('u.banned=1');
  if (truthy(online)) conds.push("u.status='online'");
  if (period === 'today') { conds.push('u.created_at > ?'); args.push(Math.floor(Date.now() / 1000) - 86400); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) n FROM users u ${where}`).get(...args).n;
  const rows = db.prepare(`
    SELECT u.id, u.username, u.phone, u.wechat_id, u.avatar, u.bio, u.status, u.banned, u.created_at,
      (SELECT COUNT(*) FROM contacts WHERE user_id=u.id) AS contactCount,
      (SELECT COUNT(*) FROM messages WHERE sender_id=u.id AND deleted=0) AS messageCount
    FROM users u ${where}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...args, lim, off);
  return { total, limit: lim, offset: off, users: rows };
}

function userDetail(id) {
  const user = db.prepare(`
    SELECT id, username, phone, wechat_id, avatar, cover_photo, bio, status, banned, created_at
    FROM users WHERE id=?
  `).get(id);
  if (!user) throw notFound('用户不存在');
  user.contactCount = db.prepare('SELECT COUNT(*) n FROM contacts WHERE user_id=?').get(id).n;
  user.messageCount = db.prepare('SELECT COUNT(*) n FROM messages WHERE sender_id=? AND deleted=0').get(id).n;
  user.groupCount   = db.prepare("SELECT COUNT(*) n FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id AND c.type='group' WHERE cm.user_id=?").get(id).n;
  user.sessions     = db.prepare('SELECT device, platform, ip, last_seen FROM user_sessions WHERE user_id=? ORDER BY last_seen DESC').all(id);
  user.balance      = wallet.getBalance(id);
  return user;
}

// ── 后台发币（给指定用户钱包入账，走账本+流水）─────────────────────
function grantCoins(id, amount, memo) {
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt === 0 || amt < -1000000 || amt > 1000000)
    throw badRequest('发币金额需为非零整数，绝对值≤1000000');
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) throw notFound('用户不存在');
  // amt 可正可负（负=扣减/冲正）。applyDelta 内置余额不足保护。
  const balance = wallet.applyDelta(id, amt, 'admin_grant', null, memo || (amt > 0 ? '后台发币' : '后台扣减'));
  return { id, balance, granted: amt };
}

// ── 封禁 / 解封 ─────────────────────────────────────────────────
function setBanned(io, id, banned) {
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) throw notFound('用户不存在');
  db.prepare('UPDATE users SET banned=? WHERE id=?').run(banned ? 1 : 0, id);
  if (banned && io) io.to(`user_${id}`).disconnectSockets(true);
  return { id, banned: banned ? 1 : 0 };
}

// ── 重置密码 ────────────────────────────────────────────────────
async function resetPassword(id, newPassword) {
  if (!newPassword || newPassword.length < 6) throw badRequest('新密码至少6位');
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) throw notFound('用户不存在');
  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, id);
  // 踢掉该用户所有会话
  db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(id);
}

// ── 彻底删除用户（级联清理，含其消息）──────────────────────────
function deleteUser(id) {
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) throw notFound('用户不存在');

  db.transaction(() => {
    // 该用户发的消息及其衍生数据
    const msgIds = db.prepare('SELECT id FROM messages WHERE sender_id=?').all(id).map(r => r.id);
    if (msgIds.length) {
      const ph = msgIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM message_reactions WHERE message_id IN (${ph})`).run(...msgIds);
      db.prepare(`DELETE FROM message_deliveries WHERE message_id IN (${ph})`).run(...msgIds);
      db.prepare(`DELETE FROM messages_fts WHERE message_id IN (${ph})`).run(...msgIds);
      db.prepare(`DELETE FROM pinned_messages WHERE message_id IN (${ph})`).run(...msgIds);
      db.prepare(`DELETE FROM messages WHERE id IN (${ph})`).run(...msgIds);
    }
    // 该用户参与/产生的关系数据
    db.prepare('DELETE FROM message_reactions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM message_deliveries WHERE user_id=?').run(id);
    db.prepare('DELETE FROM contacts WHERE user_id=? OR contact_id=?').run(id, id);
    db.prepare('DELETE FROM friend_requests WHERE from_id=? OR to_id=?').run(id, id);
    db.prepare('DELETE FROM blocked_users WHERE user_id=? OR blocked_id=?').run(id, id);
    db.prepare('DELETE FROM conversation_settings WHERE user_id=?').run(id);
    db.prepare('DELETE FROM conversation_members WHERE user_id=?').run(id);
    db.prepare('DELETE FROM user_settings WHERE user_id=?').run(id);
    db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM device_tokens WHERE user_id=?').run(id);
    db.prepare('DELETE FROM collections WHERE user_id=?').run(id);
    db.prepare('DELETE FROM red_packet_claims WHERE user_id=?').run(id);
    db.prepare('DELETE FROM red_packet_claims WHERE red_packet_id IN (SELECT id FROM red_packets WHERE sender_id=?)').run(id);
    db.prepare('DELETE FROM red_packets WHERE sender_id=?').run(id);
    db.prepare('DELETE FROM wallet_transactions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM wallets WHERE user_id=?').run(id);
    db.prepare('DELETE FROM device_accounts WHERE user_id=?').run(id);
    db.prepare('DELETE FROM user_stickers WHERE user_id=?').run(id);
    // 先清该用户对他人动态的互动记录（自身动态的互动由 ON DELETE CASCADE 随 moments 删除）
    db.prepare('DELETE FROM moment_likes WHERE user_id=?').run(id);
    db.prepare('DELETE FROM moment_comments WHERE user_id=?').run(id);
    db.prepare("DELETE FROM moment_notifications WHERE user_id=? OR actor_id=?").run(id, id);
    db.prepare('DELETE FROM moment_reports WHERE reporter_id=?').run(id);
    db.prepare('DELETE FROM moments WHERE user_id=?').run(id);
    // 清理只剩 0 个成员的私聊会话
    db.prepare(`
      DELETE FROM conversations WHERE type='private'
        AND id NOT IN (SELECT DISTINCT conversation_id FROM conversation_members)
    `).run();
    db.prepare('DELETE FROM users WHERE id=?').run(id);
  })();
}

// ── 消息监控（今日 / 搜索）──────────────────────────────────────
function listMessages({ q, period, limit = 30, offset = 0 }) {
  const lim = Math.min(parseInt(limit) || 30, 100);
  const off = Math.max(parseInt(offset) || 0, 0);
  const conds = ['m.deleted=0'], args = [];
  if (period === 'today') { conds.push('m.created_at > ?'); args.push(Math.floor(Date.now() / 1000) - 86400); }
  if (q) { conds.push("m.content LIKE ? ESCAPE '\\'"); args.push(`%${escapeLike(q)}%`); }
  const where = 'WHERE ' + conds.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) n FROM messages m ${where}`).get(...args).n;
  const rows = db.prepare(`
    SELECT m.id, m.type, m.content, m.created_at, m.conversation_id,
           u.username AS senderName, c.type AS convType, c.name AS convName
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    JOIN conversations c ON c.id = m.conversation_id
    ${where}
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, lim, off);
  return { total, limit: lim, offset: off, messages: rows };
}

// ── 群列表 / 详情 / 解散 ────────────────────────────────────────
function listGroups({ q, limit = 30, offset = 0 }) {
  const lim = Math.min(parseInt(limit) || 30, 100);
  const off = Math.max(parseInt(offset) || 0, 0);
  const like = q ? `%${q}%` : null;
  const where = q ? "AND (c.name LIKE ? OR c.group_number LIKE ?)" : '';
  const args = q ? [like, like] : [];

  const total = db.prepare(`SELECT COUNT(*) n FROM conversations c WHERE c.type='group' ${where}`).get(...args).n;
  const rows = db.prepare(`
    SELECT c.id, c.name, c.group_number, c.avatar, c.owner_id, c.created_at,
      ou.username AS ownerName,
      (SELECT COUNT(*) FROM conversation_members WHERE conversation_id=c.id) AS memberCount,
      (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND deleted=0) AS messageCount
    FROM conversations c
    LEFT JOIN users ou ON ou.id = c.owner_id
    WHERE c.type='group' ${where}
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...args, lim, off);
  return { total, limit: lim, offset: off, groups: rows };
}

function groupDetail(id) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id=? AND type='group'").get(id);
  if (!conv) throw notFound('群不存在');
  conv.members = db.prepare(`
    SELECT u.id, u.username, u.avatar, cm.role, cm.joined_at
    FROM conversation_members cm JOIN users u ON u.id=cm.user_id
    WHERE cm.conversation_id=?
    ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, cm.joined_at
  `).all(id);
  return conv;
}

function dismissGroup(io, id) {
  const conv = db.prepare("SELECT id FROM conversations WHERE id=? AND type='group'").get(id);
  if (!conv) throw notFound('群不存在');
  purgeConversation(id); // 完整级联清理，含消息（修复外键约束 500）
  if (io) io.to(id).emit('group_dismissed', { conversationId: id });
}

// ── 邀请码（运行时可改，存 admin_settings，回退 .env）────────────
function getInviteCode() {
  const row = db.prepare("SELECT value FROM admin_settings WHERE key='invite_code'").get();
  return row?.value ?? config.inviteCode;
}
function setInviteCode(code) {
  if (!code || !/^\d{6}$/.test(code)) throw badRequest('邀请码必须是6位数字');
  db.prepare(`
    INSERT INTO admin_settings (key, value, updated_at) VALUES ('invite_code', ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(code);
  return code;
}

// 随机生成并保存一个 6 位数字邀请码
function generateInviteCode() {
  return setInviteCode(String(Math.floor(100000 + Math.random() * 900000)));
}

// ── 功能开关（后台可隐藏：朋友圈 / 收藏）默认开启 ────────────────
function getFeatures() {
  const get = k => db.prepare('SELECT value FROM admin_settings WHERE key=?').get(k)?.value;
  return {
    moments: get('feature_moments') !== 'off',
    collect: get('feature_collect') !== 'off',
  };
}
function setFeatures({ moments, collect }) {
  const set = (k, on) => db.prepare(`
    INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(k, on ? 'on' : 'off');
  if (moments !== undefined) set('feature_moments', !!moments);
  if (collect !== undefined) set('feature_collect', !!collect);
  return getFeatures();
}

// ── 朋友圈举报队列（MO6 后台）──────────────────────────────────
function listReports({ status = 'pending', limit = 30, offset = 0 } = {}) {
  const lim = Math.min(parseInt(limit) || 30, 100);
  const off = Math.max(parseInt(offset) || 0, 0);
  const st = ['pending', 'reviewed', 'dismissed'].includes(status) ? status : 'pending';
  const total = db.prepare('SELECT COUNT(*) n FROM moment_reports WHERE status=?').get(st).n;
  const rows = db.prepare(`
    SELECT r.id, r.moment_id, r.reason, r.status, r.created_at,
           ru.username AS reporterName,
           m.content AS momentContent, m.images AS momentImages, m.user_id AS authorId,
           au.username AS authorName,
           (SELECT COUNT(*) FROM moment_reports x WHERE x.moment_id = r.moment_id) AS reportCount
    FROM moment_reports r
    LEFT JOIN users ru ON ru.id = r.reporter_id
    LEFT JOIN moments m ON m.id = r.moment_id
    LEFT JOIN users au ON au.id = m.user_id
    WHERE r.status = ?
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `).all(st, lim, off);
  return {
    total, limit: lim, offset: off,
    reports: rows.map(r => ({ ...r, momentImages: JSON.parse(r.momentImages || '[]') })),
  };
}

// 处理举报：dismiss=忽略(仅标记)；delete=删被举报动态(连带评论/点赞/通知/举报)
function resolveReport(reportId, action) {
  const r = db.prepare('SELECT * FROM moment_reports WHERE id=?').get(reportId);
  if (!r) throw notFound('举报不存在');
  if (action === 'delete') {
    moments.purgeMoment(r.moment_id);   // 复用 moments.service 的级联删除
    return { success: true, action: 'deleted' };
  }
  db.prepare("UPDATE moment_reports SET status='dismissed' WHERE id=?").run(reportId);
  return { success: true, action: 'dismissed' };
}

module.exports = {
  verifyCredentials, stats, listUsers, userDetail, setBanned, resetPassword,
  grantCoins, deleteUser, listMessages, listGroups, groupDetail, dismissGroup,
  getInviteCode, setInviteCode, generateInviteCode,
  getFeatures, setFeatures,
  listReports, resolveReport,
};
