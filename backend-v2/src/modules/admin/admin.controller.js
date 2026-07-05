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

const io = req => req.app.get('io');
const DEVICE_COOKIE = 'vxin_admin_device';

function setAdminCookie(req, res) {
  const csrf = uuidv4();
  const token = jwt.sign({ admin: true, username: config.admin.username, csrf }, config.adminJwtSecret, {
    expiresIn: `${config.admin.tokenMaxAge}s`,
  });
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
exports.login = asyncHandler(async (req, res) => {
  const { username, password, code } = req.body;
  svc.verifyCredentials(username, password); // 密码错误抛 401

  const ip = sec.clientIp(req);
  const label = sec.deviceLabel(req.headers['user-agent']);
  let deviceId = req.cookies?.[DEVICE_COOKIE] || null;

  // 未启用谷歌验证：引导设置，并把当前设备/IP 设为首个可信
  if (!sec.totpEnabled()) {
    deviceId = ensureDeviceId(req, res);
    sec.trust(deviceId, ip, label);
    setAdminCookie(req, res);
    return res.json({ success: true, username: config.admin.username, needsTotpSetup: true });
  }

  // 已启用：可信设备+IP 直接放行
  if (deviceId && sec.isTrusted(deviceId, ip)) {
    sec.touch(deviceId, ip);
    setAdminCookie(req, res);
    return res.json({ success: true, username: config.admin.username });
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
  setAdminCookie(req, res);
  res.json({ success: true, username: config.admin.username });
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

exports.me = asyncHandler(async (req, res) => res.json({ username: req.admin.username }));

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
exports.ban        = asyncHandler(async (req, res) => res.json(svc.setBanned(req.app.get('io'), req.params.id, true)));
exports.unban      = asyncHandler(async (req, res) => res.json(svc.setBanned(req.app.get('io'), req.params.id, false)));
exports.resetPassword = asyncHandler(async (req, res) => {
  await svc.resetPassword(req.app.get('io'), req.params.id, req.body.newPassword);
  res.json({ success: true });
});
exports.grantCoins = asyncHandler(async (req, res) => res.json(svc.grantCoins(req.params.id, req.body.amount, req.body.memo)));
exports.deleteUser = asyncHandler(async (req, res) => { svc.deleteUser(req.app.get('io'), req.params.id); res.json({ success: true }); });

exports.listMessages = asyncHandler(async (req, res) => res.json(svc.listMessages(req.query)));

exports.listGroups  = asyncHandler(async (req, res) => res.json(svc.listGroups(req.query)));
exports.groupDetail = asyncHandler(async (req, res) => res.json(svc.groupDetail(req.params.id)));
exports.dismissGroup = asyncHandler(async (req, res) => { svc.dismissGroup(io(req), req.params.id); res.json({ success: true }); });

exports.getFeatures = asyncHandler(async (req, res) => res.json(svc.getFeatures()));
exports.setFeatures = asyncHandler(async (req, res) => res.json(svc.setFeatures(req.body)));

exports.topInviters = asyncHandler(async (req, res) => res.json(svc.topInviters(req.query)));

exports.listReports   = asyncHandler(async (req, res) => res.json(svc.listReports(req.query)));
exports.resolveReport = asyncHandler(async (req, res) => res.json(svc.resolveReport(req.params.id, req.body?.action)));

exports.getInviteCode = asyncHandler(async (req, res) => res.json({ inviteCode: svc.getInviteCode() }));
exports.setInviteCode = asyncHandler(async (req, res) => res.json({ inviteCode: svc.setInviteCode(req.body.inviteCode) }));
exports.generateInviteCode = asyncHandler(async (req, res) => res.json({ inviteCode: svc.generateInviteCode() }));
