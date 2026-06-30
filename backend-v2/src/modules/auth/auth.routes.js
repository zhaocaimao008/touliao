'use strict';
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { loginLimiter, registerLimiter, switchLimiter, forgetLimiter, resetPasswordLimiter } = require('../../middleware/rateLimiters');
const c = require('./auth.controller');

/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Register new user
 *     description: Create a new user account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+86 13800000000"
 *               password:
 *                 type: string
 *                 example: "password123"
 *               username:
 *                 type: string
 *                 example: "user123"
 *     responses:
 *       200:
 *         description: User registered successfully
 *       400:
 *         description: Invalid request
 */
router.post('/register',        registerLimiter, c.register);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: User login
 *     description: Authenticate user and return tokens
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
router.post('/login',           loginLimiter,    c.login);

// 免密切换账号（凭 wallet cookie，需本设备登录过该账号）
router.post('/switch',          switchLimiter, c.switchAccount);
// 从本设备移除某账号（删除最近登录/退出后清理钱包）
router.post('/forget',          forgetLimiter, c.forget);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Reset password with phone and invite code
 */
router.post('/reset-password', resetPasswordLimiter, c.resetPassword);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Get current user profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved
 */
router.get ('/me',              auth,            c.me);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Refresh access token
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: New token issued
 */
router.post('/refresh',         auth,            c.refresh);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: User logout
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout',                           c.logout);

/**
 * @swagger
 * /auth/sessions:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: List active sessions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of sessions
 */
router.get ('/sessions',        auth,            c.sessions);

/**
 * @swagger
 * /auth/sessions/{id}:
 *   delete:
 *     tags:
 *       - Authentication
 *     summary: Delete a session
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
 *         description: Session deleted
 */
router.delete('/sessions',      auth,            c.deleteAllSessions);
router.delete('/sessions/:id',  auth,            c.deleteSession);
router.post  ('/delete-account',auth,            c.deleteAccount);

/**
 * @swagger
 * /auth/change-password:
 *   put:
 *     tags:
 *       - Authentication
 *     summary: Change password
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               oldPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed
 */
router.put ('/change-password', auth,            c.changePassword);

module.exports = router;
