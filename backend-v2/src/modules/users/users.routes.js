'use strict';
/**
 * /api/users —— 用户 + 联系人/好友/黑名单（原 users.js 全部挂这）。
 * ⚠ 路由顺序敏感：GET /:id 是单段通配，必须在所有单段具体路由之后注册，
 *   否则会吃掉 /search、/contacts 等。此处严格保持原始顺序。
 */
const path = require('path');
const router = require('express').Router();
const auth = require('../../middleware/auth');
const config = require('../../config');
const { makeImageUploader } = require('../../utils/upload');
const u = require('./users.controller');
const c = require('../contacts/contacts.controller');

const AVATARS_DIR = path.join(config.uploadsRoot, 'avatars');
const uploadAvatar = makeImageUploader(AVATARS_DIR, 'avatar', 1, 5  * 1024 * 1024);
const uploadCover  = makeImageUploader(AVATARS_DIR, 'cover',  1, 10 * 1024 * 1024);

// ── 个人 ────────────────────────────────────────────────────────

/**
 * @swagger
 * /users/me/qrcode:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get user QR code
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR code image
 */
router.get ('/me/qrcode',   auth, u.qrcode);

/**
 * @swagger
 * /users/me/settings:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get user settings
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User settings retrieved
 *   put:
 *     tags:
 *       - Users
 *     summary: Update user settings
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
router.get ('/me/settings', auth, u.getSettings);
router.put ('/me/settings', auth, u.updateSettings);

/**
 * @swagger
 * /users/search:
 *   get:
 *     tags:
 *       - Users
 *     summary: Search users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query
 *     responses:
 *       200:
 *         description: Search results
 */
router.get ('/search',      auth, u.search);

// ── 联系人 / 好友请求 ───────────────────────────────────────────

/**
 * @swagger
 * /users/contacts:
 *   get:
 *     tags:
 *       - Contacts
 *     summary: List user contacts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of contacts
 */
router.get ('/contacts',                  auth, c.listContacts);

/**
 * @swagger
 * /users/friend-request:
 *   post:
 *     tags:
 *       - Contacts
 *     summary: Send friend request
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetUserId:
 *                 type: string
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Request sent
 */
router.post('/friend-request',            auth, c.sendFriendRequest);

/**
 * @swagger
 * /users/friend-requests:
 *   get:
 *     tags:
 *       - Contacts
 *     summary: List received friend requests
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of requests
 */
router.get ('/friend-requests',           auth, c.listReceived);

/**
 * @swagger
 * /users/friend-requests/sent:
 *   get:
 *     tags:
 *       - Contacts
 *     summary: List sent friend requests
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of sent requests
 */
router.get ('/friend-requests/sent',      auth, c.listSent);

/**
 * @swagger
 * /users/friend-request/{id}/handle:
 *   post:
 *     tags:
 *       - Contacts
 *     summary: Accept or reject friend request
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [accept, reject]
 *     responses:
 *       200:
 *         description: Request handled
 */
router.post('/friend-request/:id/handle', auth, c.handleRequest);

/**
 * @swagger
 * /users/contacts/{contactId}:
 *   delete:
 *     tags:
 *       - Contacts
 *     summary: Delete contact
 *     parameters:
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Contact deleted
 *   put:
 *     tags:
 *       - Contacts
 *     summary: Set contact remark
 *     parameters:
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               remark:
 *                 type: string
 *     responses:
 *       200:
 *         description: Remark set
 */
/**
 * @swagger
 * /users/contacts/{contactId}:
 *   delete:
 *     tags:
 *       - Contacts
 *     summary: Delete contact
 *     parameters:
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Contact deleted
 *   put:
 *     tags:
 *       - Contacts
 *     summary: Set contact remark
 *     parameters:
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               remark:
 *                 type: string
 *     responses:
 *       200:
 *         description: Remark updated
 */
router.delete('/contacts/:contactId',     auth, c.deleteContact);
router.put ('/contacts/:contactId/remark',auth, c.setRemark);

// ── 头像 / 封面 / 资料 ──────────────────────────────────────────

/**
 * @swagger
 * /users/avatar:
 *   post:
 *     tags:
 *       - Users
 *     summary: Upload avatar
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar uploaded
 */
router.post('/avatar', auth, ...uploadAvatar, u.uploadAvatar);

/**
 * @swagger
 * /users/cover:
 *   post:
 *     tags:
 *       - Users
 *     summary: Upload cover image
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               cover:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Cover uploaded
 */
router.post('/cover',  auth, ...uploadCover,  u.uploadCover);

/**
 * @swagger
 * /users/profile:
 *   put:
 *     tags:
 *       - Users
 *     summary: Update user profile
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               bio:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.put ('/profile', auth, u.updateProfile);

// ── 单段通配（必须在此之后不再有单段 GET 具体路由）──────────────

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get user detail
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
 *         description: User profile
 */
router.get ('/:id', auth, u.getUserDetail);

// ── 两段路由（不被 /:id 影响）──────────────────────────────────

/**
 * @swagger
 * /users/me/collections:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get user collections
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of collections
 *   delete:
 *     tags:
 *       - Users
 *     summary: Remove collection item
 *     parameters:
 *       - in: query
 *         name: id
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Item removed
 */
/**
 * @swagger
 * /users/me/collections/search:
 *   get:
 *     tags: [Users]
 *     summary: 搜索收藏（按内容模糊匹配，分页）
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: offset
 *         schema: { type: integer }
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ items, total, hasMore }"
 * /users/me/collections/{id}:
 *   get:
 *     tags: [Users]
 *     summary: 单条收藏详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 收藏详情
 *       404:
 *         description: 收藏不存在
 */
router.get   ('/me/collections',        auth, u.getCollections);
router.post  ('/me/collections',        auth, u.addCollection);
// ⚠ /search 静态路径必须在 /:id 之前注册，否则 search 会被当作收藏 id
router.get   ('/me/collections/search', auth, u.searchCollections);
router.get   ('/me/collections/:id',    auth, u.getCollection);
router.delete('/me/collections/:id',    auth, u.removeCollection);

/**
 * @swagger
 * /users/me/call-logs:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get call logs
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of call logs
 */
router.get   ('/me/call-logs', auth, u.getCallLogs);

/**
 * @swagger
 * /users/block/{targetId}:
 *   post:
 *     tags:
 *       - Contacts
 *     summary: Block user
 *     parameters:
 *       - in: path
 *         name: targetId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User blocked
 *   delete:
 *     tags:
 *       - Contacts
 *     summary: Unblock user
 *     parameters:
 *       - in: path
 *         name: targetId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User unblocked
 */
router.post  ('/block/:targetId', auth, c.block);
router.delete('/block/:targetId', auth, c.unblock);

/**
 * @swagger
 * /users/me/blocked:
 *   get:
 *     tags:
 *       - Contacts
 *     summary: List blocked users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of blocked users
 */
router.get   ('/me/blocked',      auth, c.listBlocked);

module.exports = router;
