'use strict';
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');
const { authCookieOptions, csrfCookieOptions } = require('../../utils/cookies');
const { asyncHandler } = require('../../utils/http');
const { addToBlacklist } = require('../../utils/tokenBlacklist');
const svc = require('./admin.service');
const sec = require('./security.service');
const prodMetrics = require('../../utils/prodMetrics');
const presence = require('../../realtime/presence');
const { logAuditEvent } = require('../../utils/auditLogger');
const moderation = require('../moderation/moderation.service');

const io = req => req.app.get('io');
const DEVICE_COOKIE = 'vxin_admin_device';

// identity = { username, role, adminId }，来自 verifyCredentials 的真实登录者身份
// （2026-09-02 多管理员前，这里一直硬编码签 config.admin.username——即便以后加了别的
// 管理员账号，cookie 里也永远写的是 env 账号，审计日志会把所有人的操作都记成同一个人）。
function setAdminCookie(req, res, identity) {
  const csrf = uuidv4();
  const token = jwt.sign(
    { admin: true, username: identity.username, role: identity.role, adminId: identity.adminId, csrf },
    config.adminJwtSecret,
    { expiresIn: `${config.admin.tokenMaxAge}s` }
  );
  res.cookie(config.admin.cookieName, token, {
    ...authCookieOptions(req),
    maxAge: config.admin.tokenMaxAge * 1000,
  });
  // 登录响应即下发CSRF token，避免首次POST无CSRF头（H8）
  res.cookie(config.csrfCookie, csrf, csrfCookieOptions(req));
  res.setHeader('X-CSRF-Token', csrf);
  return csrf;
}

// 持久设备标识（1年），用于「记住此设备」
function ensureDeviceId(req, res) {
  let id = req.cookies?.[DEVICE_COOKIE];
  if (!id) {
    id = uuidv4();
    res.cookie(DEVICE_COOKIE, id, { ...authCookieOptions(req), httpOnly: true, maxAge: 365 * 24 * 3600 * 1000 });
  }
  return id;
}

// ── 登录（密码 → 设备/IP 白名单 → 陌生则需谷歌验证码）────────────
// 谷歌验证器/可信设备目前是全局共享的一道闸门（不是每个管理员各自独立绑定一个验证器），
// 谁的账号密码通过了都受同一套设备信任状态约束——多管理员场景下这是有意的简化，
// 不是遗漏：真正做到"每人独立 2FA"是更大的改动，本次只做到"谁登录的、身份如实记录"。
exports.login = asyncHandler(async (req, res) => {
  const { username, password, code } = req.body;
  const identity = svc.verifyCredentials(username, password); // 密码错误抛 401

  const ip = sec.clientIp(req);
  const label = sec.deviceLabel(req.headers['user-agent']);
  let deviceId = req.cookies?.[DEVICE_COOKIE] || null;

  // 未启用谷歌验证：引导设置，并把当前设备/IP 设为首个可信
  if (!sec.totpEnabled()) {
    deviceId = ensureDeviceId(req, res);
    sec.trust(deviceId, ip, label);
    setAdminCookie(req, res, identity);
    return res.json({ success: true, username: identity.username, role: identity.role, needsTotpSetup: true });
  }

  // 已启用：可信设备+IP 直接放行
  if (deviceId && sec.isTrusted(deviceId, ip)) {
    sec.touch(deviceId, ip);
    setAdminCookie(req, res, identity);
    return res.json({ success: true, username: identity.username, role: identity.role });
  }

  // 陌生设备/IP：必须提供正确谷歌验证码
  if (!code) {
    return res.status(403).json({ error: '陌生设备或 IP，请输入谷歌验证码', needCode: true });
  }
  if (!sec.verifyCode(code)) {
    return res.status(401).json({ error: '谷歌验证码错误' });
  }
  deviceId = ensureDeviceId(req, res);
  sec.trust(deviceId, ip, label);
  setAdminCookie(req, res, identity);
  res.json({ success: true, username: identity.username, role: identity.role });
});

// ── 安全设置 ────────────────────────────────────────────────────
exports.securityStatus = asyncHandler(async (req, res) => res.json(sec.status()));

exports.totpSetup = asyncHandler(async (req, res) => {
  const { secret, otpauth } = sec.beginSetup();
  const qr = await QRCode.toDataURL(otpauth, { width: 200, margin: 1 });
  res.json({ secret, otpauth, qr });
});

exports.totpEnable  = asyncHandler(async (req, res) => { sec.enableTotp(req.body.code);  res.json({ success: true, totpEnabled: true }); });
exports.totpDisable = asyncHandler(async (req, res) => { sec.disableTotp(req.body.code); res.json({ success: true, totpEnabled: false }); });
exports.revokeTrusted = asyncHandler(async (req, res) => { sec.revokeTrusted(req.params.id); res.json({ success: true }); });

exports.logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[config.admin.cookieName] || req.adminToken;
  if (token) {
    try {
      const payload = jwt.decode(token);
      if (payload?.exp) {
        addToBlacklist(token, payload.exp);
      }
    } catch { /* ignore */ }
  }
  res.clearCookie(config.admin.cookieName, { path: '/' });
  res.json({ success: true });
});

exports.me = asyncHandler(async (req, res) => res.json({ username: req.admin.username, role: req.admin.role || 'superadmin' }));

// ── 数据 ────────────────────────────────────────────────────────
exports.stats = asyncHandler(async (req, res) =>
  res.json(svc.stats(req.app.get('onlineUsers')?.size || 0)));

// 生产监控指标快照（10 项指标 + 阈值 + 近期告警）
exports.metrics = asyncHandler(async (req, res) => {
  const online = presence.stats();
  res.json(prodMetrics.snapshot(online.users, online.sockets));
});

exports.listUsers  = asyncHandler(async (req, res) => res.json(svc.listUsers(req.query)));
exports.userDetail = asyncHandler(async (req, res) => res.json(svc.userDetail(req.params.id)));
exports.ban = asyncHandler(async (req, res) => {
  const result = svc.setBanned(req.app.get('io'), req.params.id, true);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'USER_BAN',
    resourceType: 'user',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  res.json(result);
});

exports.unban = asyncHandler(async (req, res) => {
  const result = svc.setBanned(req.app.get('io'), req.params.id, false);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'USER_UNBAN',
    resourceType: 'user',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  res.json(result);
});
exports.resetPassword = asyncHandler(async (req, res) => {
  await svc.resetPassword(req.app.get('io'), req.params.id, req.body.newPassword);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'USER_PASSWORD_RESET',
    resourceType: 'user',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  res.json({ success: true });
});

exports.grantPrivilege = asyncHandler(async (req, res) => {
  const result = svc.setPrivilege(req.params.id, true);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'USER_GRANT_PRIVILEGE',
    resourceType: 'user',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  res.json(result);
});

exports.revokePrivilege = asyncHandler(async (req, res) => {
  const result = svc.setPrivilege(req.params.id, false);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'USER_REVOKE_PRIVILEGE',
    resourceType: 'user',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  res.json(result);
});

exports.grantCoins = asyncHandler(async (req, res) => {
  const result = svc.grantCoins(req.params.id, req.body.amount, req.body.memo);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'USER_GRANT_COINS',
    resourceType: 'user',
    resourceId: req.params.id,
    details: { amount: req.body.amount, memo: req.body.memo },
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  res.json(result);
});

exports.deleteUser = asyncHandler(async (req, res) => {
  svc.deleteUser(req.app.get('io'), req.params.id);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'USER_DELETE',
    resourceType: 'user',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  res.json({ success: true });
});

exports.deleteMessage = asyncHandler(async (req, res) => {
  await svc.deleteMessage(io(req), req.params.id);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'MESSAGE_DELETE',
    resourceType: 'message',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    riskLevel: 'high',
  });
  res.json({ success: true });
});

exports.listMessages = asyncHandler(async (req, res) => {
  const result = svc.listMessages(req.query);
  // 全文检索所有用户私聊内容属高敏操作，此前完全没有审计记录
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: req.query.q ? 'MESSAGE_SEARCH' : 'MESSAGE_BROWSE',
    resourceType: 'message',
    details: { q: req.query.q || null, period: req.query.period || null, resultCount: result.total },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    riskLevel: req.query.q ? 'high' : 'medium',
  });
  res.json(result);
});

exports.listGroups  = asyncHandler(async (req, res) => res.json(svc.listGroups(req.query)));
exports.groupDetail = asyncHandler(async (req, res) => res.json(svc.groupDetail(req.params.id)));
exports.dismissGroup = asyncHandler(async (req, res) => {
  svc.dismissGroup(io(req), req.params.id);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'GROUP_DISMISS',
    resourceType: 'group',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    riskLevel: 'high',
  });
  res.json({ success: true });
});

exports.muteGroup = asyncHandler(async (req, res) => {
  const result = svc.muteGroup(io(req), req.params.id, !!req.body?.mute_all);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: req.body?.mute_all ? 'GROUP_MUTE' : 'GROUP_UNMUTE',
    resourceType: 'group',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.json(result);
});

exports.kickMember = asyncHandler(async (req, res) => {
  const result = svc.kickMember(io(req), req.params.id, req.params.userId);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'GROUP_KICK_MEMBER',
    resourceType: 'group',
    resourceId: req.params.id,
    details: { userId: req.params.userId },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    riskLevel: 'high',
  });
  res.json(result);
});

exports.getFeatures = asyncHandler(async (req, res) => res.json(svc.getFeatures()));
exports.setFeatures = asyncHandler(async (req, res) => {
  const features = svc.setFeatures(req.body);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'FEATURES_UPDATE',
    resourceType: 'config',
    details: features,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  // 全局广播最新开关：在线客户端无需刷新即可实时显隐入口/按钮（如群语音/视频通话）
  const socketIo = io(req);
  if (socketIo) socketIo.emit('config:updated', { features });
  res.json(features);
});

exports.topInviters = asyncHandler(async (req, res) => res.json(svc.topInviters(req.query)));

exports.listReports   = asyncHandler(async (req, res) => res.json(svc.listReports(req.query)));
exports.resolveReport = asyncHandler(async (req, res) => {
  const result = svc.resolveReport(req.params.id, req.body?.action);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: `REPORT_${(req.body?.action || 'resolve').toUpperCase()}`,
    resourceType: 'report',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    riskLevel: req.body?.action === 'delete' ? 'high' : 'medium',
  });
  res.json(result);
});

// ── 管理员账号管理（仅 superadmin）──────────────────────────────
// role 缺省(旧 token，本次上线前签发、尚未过期)按 superadmin 对待——迁移前系统只有
// 一个全权限账号，不应该因为这次改动让当前已登录的管理员突然失去权限。
exports.listAdmins = asyncHandler(async (req, res) => res.json(svc.listAdmins()));
exports.createAdmin = asyncHandler(async (req, res) => {
  if (req.admin.role === 'admin') return res.status(403).json({ error: '仅超级管理员可新增管理员账号' });
  const result = await svc.createAdmin(req.body, req.admin.adminId || req.admin.username);
  logAuditEvent({
    adminId: req.admin.username, adminUsername: req.admin.username,
    action: 'ADMIN_CREATE', resourceType: 'admin_user', resourceId: result.id,
    details: { username: result.username, role: result.role },
    ip: req.ip, userAgent: req.headers['user-agent'], riskLevel: 'high',
  });
  res.json(result);
});
exports.setAdminDisabled = asyncHandler(async (req, res) => {
  if (req.admin.role === 'admin') return res.status(403).json({ error: '仅超级管理员可操作管理员账号' });
  const result = svc.setAdminDisabled(req.params.id, !!req.body?.disabled, req.admin.adminId);
  logAuditEvent({
    adminId: req.admin.username, adminUsername: req.admin.username,
    action: req.body?.disabled ? 'ADMIN_DISABLE' : 'ADMIN_ENABLE', resourceType: 'admin_user', resourceId: req.params.id,
    ip: req.ip, userAgent: req.headers['user-agent'], riskLevel: 'high',
  });
  res.json(result);
});
exports.deleteAdmin = asyncHandler(async (req, res) => {
  if (req.admin.role === 'admin') return res.status(403).json({ error: '仅超级管理员可删除管理员账号' });
  const result = svc.deleteAdmin(req.params.id, req.admin.adminId);
  logAuditEvent({
    adminId: req.admin.username, adminUsername: req.admin.username,
    action: 'ADMIN_DELETE', resourceType: 'admin_user', resourceId: req.params.id,
    ip: req.ip, userAgent: req.headers['user-agent'], riskLevel: 'high',
  });
  res.json(result);
});

exports.listBlacklistWords = asyncHandler(async (req, res) => res.json(moderation.listWords()));
exports.addBlacklistWord = asyncHandler(async (req, res) => {
  const result = moderation.addWord(req.body?.word, req.admin.username);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'BLACKLIST_ADD',
    resourceType: 'content_blacklist',
    resourceId: result.id,
    details: { word: result.word },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.json(result);
});
exports.removeBlacklistWord = asyncHandler(async (req, res) => {
  moderation.removeWord(req.params.id);
  logAuditEvent({
    adminId: req.admin.username,
    adminUsername: req.admin.username,
    action: 'BLACKLIST_REMOVE',
    resourceType: 'content_blacklist',
    resourceId: req.params.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.json({ success: true });
});

exports.getInviteCode = asyncHandler(async (req, res) => res.json({ inviteCode: svc.getInviteCode() }));
exports.setInviteCode = asyncHandler(async (req, res) => res.json({ inviteCode: svc.setInviteCode(req.body.inviteCode) }));
exports.generateInviteCode = asyncHandler(async (req, res) => res.json({ inviteCode: svc.generateInviteCode() }));
