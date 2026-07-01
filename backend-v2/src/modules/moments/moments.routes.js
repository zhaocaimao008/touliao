'use strict';
const path   = require('path');
const router = require('express').Router();
const auth   = require('../../middleware/auth');
const m      = require('./moments.controller');
const { makeImageUploader } = require('../../utils/upload');
const config = require('../../config');
const { momentImageLimiter, createMomentLimiter, commentLimiter, reactLimiter } = require('../../middleware/rateLimiters');
const uploadMomentImages = makeImageUploader(path.join(config.uploadsRoot, 'moments'), 'images', 9, 5 * 1024 * 1024);

/**
 * @swagger
 * /moments:
 *   get:
 *     tags:
 *       - Moments
 *     summary: Get timeline
 *     description: Get moments from self and friends
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Timeline moments
 *   post:
 *     tags:
 *       - Moments
 *     summary: Create moment
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
 *               images:
 *                 type: array
 *               visibility:
 *                 type: string
 *     responses:
 *       200:
 *         description: Moment created
 */
router.get   ('/',                auth, m.timeline);
router.post  ('/',                auth, createMomentLimiter, m.create);
router.post  ('/images',          auth, momentImageLimiter, ...uploadMomentImages, m.uploadImages);

/**
 * @swagger
 * /moments/user/{userId}:
 *   get:
 *     tags:
 *       - Moments
 *     summary: Get user moments
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User moments
 */
router.get   ('/user/:userId',    auth, m.userMoments);

/**
 * @swagger
 * /moments/notifications:
 *   get:
 *     tags: [Moments]
 *     summary: 朋友圈互动通知列表（谁赞了/评论了你）
 *     parameters:
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
 *         description: 通知列表
 * /moments/notifications/unread-count:
 *   get:
 *     tags: [Moments]
 *     summary: 未读互动通知数
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ count }"
 * /moments/notifications/read:
 *   post:
 *     tags: [Moments]
 *     summary: 标记互动通知全部已读
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 已读
 */
// ⚠ 必须在 GET /:id 之前注册，否则 /notifications 会被 /:id 吞掉
router.get   ('/notifications',              auth, m.notifications);
router.get   ('/notifications/unread-count', auth, m.notifUnreadCount);
router.post  ('/notifications/read',         auth, m.notifMarkRead);

/**
 * @swagger
 * /moments/comments/{commentId}:
 *   delete:
 *     tags:
 *       - Moments
 *     summary: Delete comment
 *     parameters:
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Comment deleted
 */
router.delete('/comments/:commentId', auth, m.deleteComment);

/**
 * @swagger
 * /moments/{id}:
 *   get:
 *     tags:
 *       - Moments
 *     summary: Get single moment detail
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
 *         description: Moment detail
 *       403:
 *         description: Not visible to viewer
 *       404:
 *         description: Moment not found
 */
router.get   ('/:id',             auth, m.detail);

/**
 * @swagger
 * /moments/{id}:
 *   delete:
 *     tags:
 *       - Moments
 *     summary: Delete moment
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
 *         description: Moment deleted
 */
router.delete('/:id',             auth, m.remove);

/**
 * @swagger
 * /moments/{id}/like:
 *   post:
 *     tags:
 *       - Moments
 *     summary: Like or unlike moment
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
 *         description: Like toggled
 */
router.post  ('/:id/like',        auth, reactLimiter, m.like);

/**
 * @swagger
 * /moments/{id}/comment:
 *   post:
 *     tags:
 *       - Moments
 *     summary: Comment on moment
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
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Comment created
 */
router.post  ('/:id/comment',     auth, commentLimiter, m.comment);

/**
 * @swagger
 * /moments/{id}/likes:
 *   get:
 *     tags: [Moments]
 *     summary: 点赞列表（分页）
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
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
 * /moments/{id}/comments:
 *   get:
 *     tags: [Moments]
 *     summary: 评论列表（分页）
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
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
 */
router.get   ('/:id/likes',       auth, m.likes);
router.get   ('/:id/comments',    auth, m.comments);

/**
 * @swagger
 * /moments/{id}/report:
 *   post:
 *     tags: [Moments]
 *     summary: 举报动态（落库供后台审核）
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 已举报
 *       409:
 *         description: 已举报过该动态
 */
router.post  ('/:id/report',      auth, reactLimiter, m.report);

module.exports = router;
