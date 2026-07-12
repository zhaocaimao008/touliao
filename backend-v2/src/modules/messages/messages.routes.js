'use strict';
/**
 * /api/messages —— 会话 + 消息 + 群管理 + 红包（原 messages.js 全部挂这）。
 *
 * ⚠⚠ 路由顺序就是契约。三个单段通配必须在同方法的具体路由之后：
 *     GET  /:conversationId   ← 必须晚于 GET  /conversations /search /missed /media …
 *     POST /:conversationId   ← 必须晚于 POST /forward /batch-delete
 *     DELETE /:msgId          ← 其余 DELETE 均为多段，安全
 * 多段路由（/conversation/* /red-packet/* /:id/upload /:msgId/react 等）不会被单段通配命中。
 *
 * 唯一与原版的顺序差异：GET /media 上移到 /:conversationId 之前——
 * 原版它被通配吃掉（死代码，前端也未调用），此处修正使其可达。
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { sendMsgLimiter, reactLimiter, chunkInitLimiter, chunkUploadLimiter, joinGroupLimiter } = require('../../middleware/rateLimiters');

const conv = require('../conversations/conversations.controller');
const msg  = require('./messages.controller');
const grp  = require('../groups/groups.controller');
const rp   = require('../redpackets/redpackets.controller');

// ── 会话创建 / 列表 ─────────────────────────────────────────────

/**
 * @swagger
 * /messages/conversation/private:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Create private conversation
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participantId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Conversation created
 */
router.post('/conversation/private', auth, conv.createPrivate);
router.post('/conversation/private/batch', auth, conv.createPrivateBatch);

/**
 * @swagger
 * /messages/conversation/group:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Create group conversation
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               members:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Group created
 */
router.post('/conversation/group',   auth, joinGroupLimiter, conv.createGroup);

/**
 * @swagger
 * /messages/file-helper:
 *   get:
 *     tags:
 *       - Messages
 *     summary: Get file helper conversation
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: File helper conversation
 */
router.get ('/file-helper',          auth, conv.fileHelper);

/**
 * @swagger
 * /messages/conversations:
 *   get:
 *     tags:
 *       - Messages
 *     summary: List conversations
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of conversations
 */
router.get ('/conversations',        auth, conv.list);

/**
 * @swagger
 * /messages/conversation/{conversationId}/members:
 *   get:
 *     tags:
 *       - Messages
 *     summary: List conversation members
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of members
 */
router.get ('/conversation/:conversationId/members', auth, conv.members);

/**
 * @swagger
 * /messages/unread-counts:
 *   get:
 *     tags:
 *       - Messages
 *     summary: Get unread counts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread counts
 */
router.get ('/unread-counts',        auth, conv.unreadCounts);

/**
 * @swagger
 * /messages/my-groups:
 *   get:
 *     tags:
 *       - Messages
 *     summary: List user's groups
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of groups
 */
router.get ('/my-groups',            auth, conv.myGroups);

// ── 全局搜索 ────────────────────────────────────────────────────

/**
 * @swagger
 * /messages/search:
 *   get:
 *     tags:
 *       - Messages
 *     summary: Global message search
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Search results
 */
router.get ('/search', auth, msg.searchGlobal);

// ── 群：昵称 / 邀请链接 / 二维码 / 扫码进群 ──────────────────────

/**
 * @swagger
 * /messages/conversation/{convId}/nickname:
 *   put:
 *     tags:
 *       - Groups
 *     summary: Set group nickname for current user
 *     parameters:
 *       - in: path
 *         name: convId
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
 *               nickname:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nickname set successfully
 */
router.put ('/conversation/:convId/nickname',    auth, grp.setNickname);

/**
 * @swagger
 * /messages/conversation/{convId}/invite-link:
 *   post:
 *     tags:
 *       - Groups
 *     summary: Create group invite link
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Invite link created
 */
router.post('/conversation/:convId/invite-link', auth, reactLimiter, grp.createInviteLink);

/**
 * @swagger
 * /messages/conversation/{convId}/qr-code:
 *   get:
 *     tags:
 *       - Groups
 *     summary: Get group QR code
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR code image
 */
router.get ('/conversation/:convId/qr-code',     auth, grp.qrCode);

/**
 * @swagger
 * /messages/join/{token}:
 *   post:
 *     tags:
 *       - Groups
 *     summary: Join group via invite token
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Joined group successfully
 */
router.post('/join/:token',                      auth, joinGroupLimiter, grp.join);

// ── 断线补拉 ────────────────────────────────────────────────────

/**
 * @swagger
 * /messages/missed:
 *   get:
 *     tags:
 *       - Messages
 *     summary: Get missed messages
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: after
 *         schema:
 *           type: integer
 *         description: Get messages after timestamp
 *     responses:
 *       200:
 *         description: List of missed messages
 */
router.get ('/missed', auth, msg.missed);

// ── 群管理 ──────────────────────────────────────────────────────

/**
 * @swagger
 * /messages/conversation/{convId}:
 *   put:
 *     tags:
 *       - Groups
 *     summary: Update group information
 *     parameters:
 *       - in: path
 *         name: convId
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
 *               name:
 *                 type: string
 *               announcement:
 *                 type: string
 *     responses:
 *       200:
 *         description: Group updated
 */
router.put   ('/conversation/:convId',               auth, grp.updateInfo);

/**
 * @swagger
 * /messages/conversation/{convId}/avatar:
 *   put:
 *     tags:
 *       - Groups
 *     summary: Set group avatar
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
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
 *         description: Avatar updated
 */
router.put   ('/conversation/:convId/avatar',         auth, ...grp.avatarMiddlewares, grp.setAvatar);

/**
 * @swagger
 * /messages/conversation/{convId}/invite:
 *   post:
 *     tags:
 *       - Groups
 *     summary: Invite users to group
 *     parameters:
 *       - in: path
 *         name: convId
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
 *               userIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Users invited
 */
router.post  ('/conversation/:convId/invite',         auth, joinGroupLimiter, grp.invite);

/**
 * @swagger
 * /messages/conversation/{convId}/members/{uid}:
 *   delete:
 *     tags:
 *       - Groups
 *     summary: Remove user from group
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: uid
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User removed
 */
router.delete('/conversation/:convId/members/:uid',   auth, grp.kick);

/**
 * @swagger
 * /messages/conversation/{convId}/leave:
 *   post:
 *     tags:
 *       - Groups
 *     summary: Leave group
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Left group successfully
 */
router.post  ('/conversation/:convId/leave',          auth, grp.leave);
router.post  ('/conversation/:convId/dissolve',       auth, grp.dissolve);

/**
 * @swagger
 * /messages/conversation/{convId}/info:
 *   get:
 *     tags:
 *       - Groups
 *     summary: Get group information
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Group information
 */
router.get   ('/conversation/:convId/info',           auth, grp.info);

/**
 * @swagger
 * /messages/conversation/{convId}/manage:
 *   put:
 *     tags:
 *       - Groups
 *     summary: Manage group settings
 *     parameters:
 *       - in: path
 *         name: convId
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
 *     responses:
 *       200:
 *         description: Settings updated
 */
router.put   ('/conversation/:convId/manage',         auth, grp.manage);

/**
 * @swagger
 * /messages/conversation/{convId}/members/{uid}/role:
 *   put:
 *     tags:
 *       - Groups
 *     summary: Set user role in group
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: uid
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
 *               role:
 *                 type: string
 *                 enum: [member, admin, owner]
 *     responses:
 *       200:
 *         description: Role updated
 */
router.put   ('/conversation/:convId/members/:uid/role', auth, grp.setRole);
router.post  ('/conversation/:convId/transfer-owner',    auth, grp.transferOwner);

// ── 会话设置 ────────────────────────────────────────────────────

/**
 * @swagger
 * /messages/conversation/{convId}/pin:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Pin or unpin conversation
 *     parameters:
 *       - in: path
 *         name: convId
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
 *               pinned:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Pinned status updated
 */
router.post  ('/conversation/:convId/pin',  auth, conv.pin);

/**
 * @swagger
 * /messages/conversation/{convId}/mute:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Mute or unmute conversation
 *     parameters:
 *       - in: path
 *         name: convId
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
 *               muted:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Muted status updated
 */
router.post  ('/conversation/:convId/mute', auth, conv.mute);

// 聊天专属背景：body { background } 传 URL 设置、空串清除
router.put   ('/conversation/:convId/background', auth, conv.background);

/**
 * @swagger
 * /messages/conversation/{convId}/read:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Mark conversation as read
 *     parameters:
 *       - in: path
 *         name: convId
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
 *               messageId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Marked as read
 */
router.post  ('/conversation/:convId/read',       auth, conv.read);
router.post  ('/conversation/:convId/mark-unread', auth, conv.markUnread);
router.post  ('/conversation/:convId/burn-after',  auth, conv.setBurnAfter);

/**
 * @swagger
 * /messages/conversation/{convId}/messages:
 *   delete:
 *     tags:
 *       - Messages
 *     summary: Clear conversation messages
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Messages cleared
 */
router.delete('/conversation/:convId/messages', auth, conv.clearConversation);

/**
 * @swagger
 * /messages/conversations/messages:
 *   delete:
 *     tags:
 *       - Messages
 *     summary: Clear all conversations
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All messages cleared
 */
router.delete('/conversations/messages',        auth, conv.clearAll);

/**
 * @swagger
 * /messages/conversation/{convId}/search:
 *   get:
 *     tags:
 *       - Messages
 *     summary: Search messages in conversation
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Search results
 */
router.get   ('/conversation/:convId/search',   auth, msg.searchInConv);

// ── 媒体列表（修正：上移到 /:conversationId 之前）───────────────

/**
 * @swagger
 * /messages/media:
 *   get:
 *     tags:
 *       - Messages
 *     summary: Get media files
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [image, video, audio]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: before
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of media files
 */
router.get('/media', auth, conv.media);

// ── 单段 GET 通配：消息历史 ─────────────────────────────────────

/**
 * @swagger
 * /messages/{conversationId}:
 *   get:
 *     tags:
 *       - Messages
 *     summary: Get message history
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Message history
 *   post:
 *     tags:
 *       - Messages
 *     summary: Send message
 *     parameters:
 *       - in: path
 *         name: conversationId
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
 *               content:
 *                 type: string
 *               type:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message sent
 *   delete:
 *     tags:
 *       - Messages
 *     summary: Delete message
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Message deleted
 */
/**
 * @swagger
 * /messages/{conversationId}:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Send message
 *     parameters:
 *       - in: path
 *         name: conversationId
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
 *               content:
 *                 type: string
 *               type:
 *                 type: string
 *               replyToId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message sent
 *   delete:
 *     tags:
 *       - Messages
 *     summary: Delete message
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: msgId
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Message deleted
 */
router.get('/:conversationId', auth, msg.history);
router.get('/:convId/around/:msgId', auth, msg.aroundMessage);

// ── 转发 / 批量撤回（POST 单段字面量，必须早于 POST /:conversationId）──

/**
 * @swagger
 * /messages/forward:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Forward messages
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messageIds:
 *                 type: array
 *               targetConversationId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Messages forwarded
 */
router.post('/forward',      auth, sendMsgLimiter, msg.forward);

/**
 * @swagger
 * /messages/batch-delete:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Batch delete messages
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messageIds:
 *                 type: array
 *     responses:
 *       200:
 *         description: Messages deleted
 */
router.post('/batch-delete', auth, sendMsgLimiter, msg.batchDelete);

// ── 单段 POST 通配：HTTP 发消息 ─────────────────────────────────
router.post('/:conversationId', auth, sendMsgLimiter, msg.send);

// ── 文件上传：权限门控 → multer+魔数 → 入库广播 ─────────────────

/**
 * @swagger
 * /messages/{conversationId}/upload:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Upload file to conversation
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: File uploaded
 */
router.post('/:conversationId/upload', auth, msg.uploadGuard, ...msg.uploadMiddlewares, msg.uploadHandle);

// ── 分片 / 断点续传上传（大文件）───────────────────────────────
const chunkUp = require('../upload/chunk');
const rawChunk = require('express').raw({ type: '*/*', limit: chunkUp.MAX_CHUNK + 1024 });
router.post('/:conversationId/upload-init',         auth, chunkInitLimiter, chunkUp.init);
router.get ('/:conversationId/upload-status/:uploadId', auth, chunkUp.status);
router.put ('/:conversationId/upload-chunk/:uploadId',  auth, chunkUploadLimiter, rawChunk, chunkUp.chunk);
router.post('/:conversationId/upload-finish/:uploadId', auth, chunkUp.finish);

// ── 单段 DELETE 通配：撤回消息 ──────────────────────────────────

/**
 * @swagger
 * /messages/{msgId}:
 *   delete:
 *     tags:
 *       - Messages
 *     summary: Recall message
 *     parameters:
 *       - in: path
 *         name: msgId
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
 *               forEveryone:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Message recalled
 */
router.delete('/:msgId', auth, reactLimiter, msg.remove);

// ── 消息操作 ────────────────────────────────────────────────────

/**
 * @swagger
 * /messages/{msgId}/react:
 *   post:
 *     tags:
 *       - Messages
 *     summary: React to message
 *     parameters:
 *       - in: path
 *         name: msgId
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
 *               emoji:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reaction added or removed
 */
router.post('/:msgId/react', auth, reactLimiter, msg.react);

/**
 * @swagger
 * /messages/{msgId}/edit:
 *   put:
 *     tags:
 *       - Messages
 *     summary: Edit message
 *     parameters:
 *       - in: path
 *         name: msgId
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
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message edited
 */
router.put ('/:msgId/edit',  auth, reactLimiter, msg.edit);

// ── 置顶消息 ────────────────────────────────────────────────────

/**
 * @swagger
 * /messages/conversation/{convId}/pin-message:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Pin message in conversation
 *     parameters:
 *       - in: path
 *         name: convId
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
 *               messageId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message pinned
 */
router.post  ('/conversation/:convId/pin-message',         auth, grp.pinMessage);

/**
 * @swagger
 * /messages/conversation/{convId}/pin-message/{msgId}:
 *   delete:
 *     tags:
 *       - Messages
 *     summary: Unpin message
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: msgId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Message unpinned
 */
router.delete('/conversation/:convId/pin-message/:msgId',  auth, grp.unpinMessage);

/**
 * @swagger
 * /messages/conversation/{convId}/pinned-messages:
 *   get:
 *     tags:
 *       - Messages
 *     summary: Get pinned messages
 *     parameters:
 *       - in: path
 *         name: convId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pinned messages
 */
router.get   ('/conversation/:convId/pinned-messages',     auth, grp.listPinned);

// ── 收藏 ────────────────────────────────────────────────────────

/**
 * @swagger
 * /messages/{msgId}/collect:
 *   post:
 *     tags:
 *       - Messages
 *     summary: Collect message
 *     parameters:
 *       - in: path
 *         name: msgId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Message collected
 */
router.post('/:msgId/collect', auth, reactLimiter, msg.collect);

// ── 红包 ────────────────────────────────────────────────────────

/**
 * @swagger
 * /messages/red-packet/send:
 *   post:
 *     tags:
 *       - RedPackets
 *     summary: Send red packet
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               conversationId:
 *                 type: string
 *               amount:
 *                 type: number
 *               count:
 *                 type: integer
 *               greeting:
 *                 type: string
 *     responses:
 *       200:
 *         description: Red packet sent
 */
router.post('/red-packet/send',            auth, rp.send);

/**
 * @swagger
 * /messages/red-packet/{packetId}:
 *   get:
 *     tags:
 *       - RedPackets
 *     summary: Get red packet details
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Red packet details
 */
router.get ('/red-packet/:packetId',       auth, rp.detail);

/**
 * @swagger
 * /messages/red-packet/{packetId}/claim:
 *   post:
 *     tags:
 *       - RedPackets
 *     summary: Claim red packet
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Red packet claimed
 */
router.post('/red-packet/:packetId/claim', auth, rp.claim);

module.exports = router;
