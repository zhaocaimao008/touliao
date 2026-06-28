'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');
const { db, generateVxinId } = require('../../db/connection');
const { badRequest, notFound, forbidden } = require('../../utils/http');
const { addToBlacklist } = require('../../utils/tokenBlacklist');

// 运行时邀请码：支持多个逗号分隔（后台可改）
function currentInviteCode() {
  const row = db.prepare("SELECT value FROM admin_settings WHERE key='invite_code'").get();
  return row?.value ?? config.inviteCode;
}

function isValidInviteCode(code) {
  if (!/^\d{6}$/.test(code)) return false;
  const raw = currentInviteCode();
  // 必须先配置邀请码才能注册：未配置时一律拒绝（不再默认放行任意 6 位码）
  if (!raw) return false;
  return raw.split(',').map(s => s.trim()).includes(code);
}

// ── 工具 ────────────────────────────────────────────────────────
function detectDevice(ua = '') {
  if (/Windows/i.test(ua))        return { device: 'Windows PC', platform: 'Windows' };
  if (/Macintosh|Mac OS/i.test(ua)) return { device: 'Mac', platform: 'Mac' };
  if (/iPhone/i.test(ua))         return { device: 'iPhone', platform: 'iPhone' };
  if (/iPad/i.test(ua))           return { device: 'iPad', platform: 'iPad' };
  if (/Android/i.test(ua))        return { device: 'Android 手机', platform: 'Android' };
  if (/Linux/i.test(ua))          return { device: 'Linux PC', platform: 'Linux' };
  return { device: '浏览器', platform: 'Web' };
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, csrf: uuidv4() },
    config.jwtSecret,
    { expiresIn: `${config.tokenMaxAge}s` }
  );
}

function serializeUser(u) {
  return {
    id: u.id, username: u.username, phone: u.phone,
    avatar: u.avatar || '', bio: u.bio || '',
    wechat_id: u.wechat_id || '', cover_photo: u.cover_photo || '',
  };
}

function upsertSession(userId, req) {
  const { device, platform } = detectDevice(req.headers['user-agent']);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO user_sessions (id, user_id, device, platform, ip, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, device, platform) DO UPDATE SET ip=excluded.ip, last_seen=excluded.last_seen
  `).run(uuidv4(), userId, device, platform, getClientIp(req), now, now);
}

// ── 业务 ────────────────────────────────────────────────────────
async function register({ username, phone, password, inviteCode }) {
  if (!username || !phone || !password) throw badRequest('请填写所有字段');
  if (typeof username !== 'string' || username.length < 1 || username.length > 30)
    throw badRequest('用户名长度为 1-30 字符');
  if (typeof phone !== 'string' || phone.length < 5 || phone.length > 20 || !/^\+?[\d\s\-]{5,20}$/.test(phone))
    throw badRequest('手机号格式不正确');
  if (!inviteCode || !/^\d{6}$/.test(inviteCode)) throw badRequest('邀请码必须是6位数字');
  if (!isValidInviteCode(inviteCode)) throw badRequest('邀请码不正确');
  if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(password))
    throw badRequest('密码必须至少8位，且至少包含1个字母和1个数字');

  if (db.prepare('SELECT id FROM users WHERE phone=? OR username=?').get(phone, username))
    throw badRequest('用户名或手机号已存在');

  const hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  const wechatId = generateVxinId();
  db.prepare('INSERT INTO users (id,username,phone,password,wechat_id) VALUES (?,?,?,?,?)')
    .run(id, username, phone, hash, wechatId);

  const user = { id, username, phone, avatar: '', bio: '', wechat_id: wechatId, cover_photo: '' };
  return { token: signToken({ id, username }), user };
}

async function login({ phone, password }) {
  if (!phone || !password) throw badRequest('请填写手机号和密码');
  const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!user || !await bcrypt.compare(password, user?.password || '')) throw badRequest('手机号或密码错误');
  if (user.banned) throw forbidden('账号已被封禁，请联系管理员');
  return { token: signToken(user), user: serializeUser(user) };
}

function getMe(userId) {
  const user = db.prepare('SELECT id,username,phone,avatar,bio,wechat_id,cover_photo FROM users WHERE id=?').get(userId);
  return user ? serializeUser(user) : null;
}

function refreshToken(payload) {
  return signToken({ id: payload.id, username: payload.username });
}

function listSessions(userId, req) {
  const { device, platform } = detectDevice(req.headers['user-agent']);
  const sessions = db.prepare('SELECT * FROM user_sessions WHERE user_id=? ORDER BY last_seen DESC').all(userId);
  db.prepare('UPDATE user_sessions SET last_seen=? WHERE user_id=? AND device=? AND platform=?')
    .run(Math.floor(Date.now() / 1000), userId, device, platform);
  return sessions.map(s => ({ ...s, current: s.device === device && s.platform === platform }));
}

function deleteSession(userId, sessionId) {
  db.prepare('DELETE FROM user_sessions WHERE id=? AND user_id=?').run(sessionId, userId);
}

async function changePassword(userId, { oldPassword, newPassword, currentToken }) {
  if (!oldPassword || !newPassword) throw badRequest('请填写完整');
  if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(newPassword)) throw badRequest('新密码至少8位且需包含字母和数字');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) throw notFound('用户不存在');
  if (!await bcrypt.compare(oldPassword, user.password)) throw badRequest('当前密码错误');
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, userId);
  // 改密码后吊销所有旧会话（H6）
  const sessions = db.prepare('SELECT id, token_hash FROM user_sessions WHERE user_id=?').all(userId);
  for (const s of sessions) {
    if (s.token_hash && s.token_hash.startsWith('ey')) {
      try {
        const payload = jwt.decode(s.token_hash);
        if (payload?.exp) await addToBlacklist(s.token_hash, payload.exp);
      } catch { /* ignore decode errors */ }
    }
  }
  db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(userId);
  return signToken(user);
}

// ── 设备多账号（丝滑切换）────────────────────────────────────────
// 记录"本设备(wallet)曾密码登录过 user"，切换时凭此免密重签发 token。
function recordDeviceAccount(walletId, userId) {
  if (!walletId || !userId) return;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO device_accounts (wallet_id, user_id, created_at, last_used)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(wallet_id, user_id) DO UPDATE SET last_used=excluded.last_used
  `).run(walletId, userId, now, now);
}

function removeDeviceAccount(walletId, userId) {
  if (!walletId || !userId) return;
  db.prepare('DELETE FROM device_accounts WHERE wallet_id=? AND user_id=?').run(walletId, userId);
}

// 免密切换：校验本设备登录过该账号 → 重签发 token + 返回用户信息。
function switchAccount(walletId, userId) {
  if (!walletId) throw badRequest('请重新登录');
  const owned = db.prepare('SELECT 1 FROM device_accounts WHERE wallet_id=? AND user_id=?').get(walletId, userId);
  if (!owned) throw forbidden('该账号未在本设备登录过，请重新登录');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) { removeDeviceAccount(walletId, userId); throw notFound('用户不存在'); }
  if (user.banned) { removeDeviceAccount(walletId, userId); throw forbidden('账号已被封禁'); }
  db.prepare('UPDATE device_accounts SET last_used=? WHERE wallet_id=? AND user_id=?')
    .run(Math.floor(Date.now() / 1000), walletId, userId);
  return { token: signToken(user), user: serializeUser(user) };
}

/** 忘记密码：手机号 + 邀请码验证后重置（无需登录） */
async function resetPassword({ phone, inviteCode, newPassword }) {
  if (!phone || !inviteCode || !newPassword) throw badRequest('请填写所有字段');
  if (typeof phone !== 'string' || phone.length < 5 || phone.length > 20 || !/^\+?[\d\s\-]{5,20}$/.test(phone))
    throw badRequest('手机号格式不正确');
  if (!/^\d{6}$/.test(inviteCode)) throw badRequest('邀请码必须是6位数字');
  if (!isValidInviteCode(inviteCode)) throw badRequest('邀请码不正确');
  if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(newPassword))
    throw badRequest('密码必须至少8位，且至少包含1个字母和1个数字');
  const user = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
  if (!user) throw badRequest('该手机号未注册');
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
  db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(user.id);
  return { success: true };
}

module.exports = {
  register, login, getMe, refreshToken, upsertSession,
  listSessions, deleteSession, changePassword, resetPassword,
  recordDeviceAccount, removeDeviceAccount, switchAccount,
};
