'use strict';
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const config = require('../../config');
const adminAuth = require('../../middleware/adminAuth');
const c = require('./admin.controller');

// ── 后台 IP 白名单门控（最外层）──────────────────────────────────
// config.admin.ipWhitelist 为空时不限制(默认)；非空时仅放行列表内 IP。
// trust proxy 已开，req.ip 为真实客户端 IP；兼容 IPv4-mapped IPv6 (::ffff:x.x.x.x)。
const normIp = ip => (ip || '').replace(/^::ffff:/, '');
router.use((req, res, next) => {
  const wl = config.admin.ipWhitelist;
  if (!wl.length) return next();
  const ip = normIp(req.ip);
  if (wl.includes(ip)) return next();
  return res.status(403).json({ error: '后台仅限白名单 IP 访问' });
});

// 后台登录限流：15分钟 10 次
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: '登录尝试过于频繁，请稍后再试' },
  standardHeaders: true, legacyHeaders: false,
});

// ── 认证 ────────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/login:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Admin login
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post('/login',  adminLoginLimiter, c.login);

/**
 * @swagger
 * /admin/logout:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Admin logout
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout', adminAuth,          c.logout);

/**
 * @swagger
 * /admin/me:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get admin profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin profile
 */
router.get ('/me',     adminAuth,         c.me);

// ── 总览 ────────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get system statistics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System statistics
 */
router.get ('/stats',  adminAuth, c.stats);

/**
 * @swagger
 * /admin/metrics:
 *   get:
 *     tags: [Admin]
 *     summary: 生产监控指标快照（在线/消息成功率/延迟/上传/重连/CPU/内存/ELD/Worker队列/SQLite写入 + 告警）
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Production metrics JSON
 */
router.get ('/metrics', adminAuth, c.metrics);

// ── 安全（谷歌验证 + 可信设备/IP）──────────────────────────────

/**
 * @swagger
 * /admin/security:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get security status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Security status
 */
router.get   ('/security',              adminAuth, c.securityStatus);

/**
 * @swagger
 * /admin/security/totp/setup:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Setup TOTP
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: TOTP setup
 */
router.post  ('/security/totp/setup',   adminAuth, c.totpSetup);

/**
 * @swagger
 * /admin/security/totp/enable:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Enable TOTP
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: TOTP enabled
 */
router.post  ('/security/totp/enable',  adminAuth, c.totpEnable);

/**
 * @swagger
 * /admin/security/totp/disable:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Disable TOTP
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: TOTP disabled
 */
router.post  ('/security/totp/disable', adminAuth, c.totpDisable);

/**
 * @swagger
 * /admin/security/trusted/{id}:
 *   delete:
 *     tags:
 *       - Admin
 *     summary: Revoke trusted device
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Device revoked
 */
router.delete('/security/trusted/:id',  adminAuth, c.revokeTrusted);

// ── 用户管理 ────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/users:
 *   get:
 *     tags:
 *       - Admin
 *     summary: List users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of users
 */
router.get   ('/users',                adminAuth, c.listUsers);

/**
 * @swagger
 * /admin/users/{id}:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get user details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User details
 *   post:
 *     tags:
 *       - Admin
 *     summary: Ban or unban user
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User status updated
 *   delete:
 *     tags:
 *       - Admin
 *     summary: Delete user
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User deleted
 */
router.get   ('/users/:id',            adminAuth, c.userDetail);
router.post  ('/users/:id/ban',        adminAuth, c.ban);
router.post  ('/users/:id/unban',      adminAuth, c.unban);
router.post  ('/users/:id/reset-password', adminAuth, c.resetPassword);
router.post  ('/users/:id/grant-coins',    adminAuth, c.grantCoins);
router.delete('/users/:id',            adminAuth, c.deleteUser);

// ── 消息监控 ────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/messages:
 *   get:
 *     tags:
 *       - Admin
 *     summary: List messages
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of messages
 */
router.get('/messages', adminAuth, c.listMessages);

// ── 群管理 ──────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/groups:
 *   get:
 *     tags:
 *       - Admin
 *     summary: List groups
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of groups
 */
router.get   ('/groups',     adminAuth, c.listGroups);

/**
 * @swagger
 * /admin/groups/{id}:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get group details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Group details
 *   delete:
 *     tags:
 *       - Admin
 *     summary: Dismiss group
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Group dismissed
 */
router.get   ('/groups/:id', adminAuth, c.groupDetail);
router.delete('/groups/:id', adminAuth, c.dismissGroup);

// ── 邀请码 ──────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/invite-code:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get invite code settings
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Invite code settings
 *   put:
 *     tags:
 *       - Admin
 *     summary: Set invite code settings
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Settings updated
 */
router.get ('/invite-code',          adminAuth, c.getInviteCode);
router.put ('/invite-code',          adminAuth, c.setInviteCode);

/**
 * @swagger
 * /admin/invite-code/generate:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Generate invite codes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Codes generated
 */
router.post('/invite-code/generate', adminAuth, c.generateInviteCode);

// ── 功能开关（朋友圈 / 收藏 显隐）──────────────────────────────

/**
 * @swagger
 * /admin/features:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get feature flags
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Feature flags
 *   put:
 *     tags:
 *       - Admin
 *     summary: Set feature flags
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Flags updated
 */
router.get('/features', adminAuth, c.getFeatures);
router.put('/features', adminAuth, c.setFeatures);

// ── 邀请裂变排行榜（谁拉新最多）──────────────────────────────────
router.get('/top-inviters', adminAuth, c.topInviters);

// ── 朋友圈举报队列（MO6）──────────────────────────────────────────
router.get ('/reports',             adminAuth, c.listReports);
router.post('/reports/:id/resolve', adminAuth, c.resolveReport);

module.exports = router;
