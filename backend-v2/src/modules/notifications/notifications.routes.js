'use strict';
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { pushSubscribeLimiter } = require('../../middleware/rateLimiters');
const c = require('./notifications.controller');

/**
 * @swagger
 * /notifications/vapid-public-key:
 *   get:
 *     tags:
 *       - Notifications
 *     summary: Get VAPID public key for push notifications
 *     responses:
 *       200:
 *         description: VAPID public key
 */
router.get   ('/vapid-public-key',       c.vapidPublicKey);  // 公钥无需鉴权

/**
 * @swagger
 * /notifications/web-subscribe:
 *   post:
 *     tags:
 *       - Notifications
 *     summary: Subscribe to web push notifications
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
 *         description: Subscription successful
 *   delete:
 *     tags:
 *       - Notifications
 *     summary: Unsubscribe from web push notifications
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unsubscription successful
 */
router.post  ('/web-subscribe',    auth,  pushSubscribeLimiter, c.webSubscribe);
router.delete('/web-subscribe',    auth,  c.webUnsubscribe);

/**
 * @swagger
 * /notifications/device-token:
 *   post:
 *     tags:
 *       - Notifications
 *     summary: Save device token for mobile push
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token saved
 *   delete:
 *     tags:
 *       - Notifications
 *     summary: Delete device token
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token deleted
 */
router.post  ('/device-token',     auth,  pushSubscribeLimiter, c.saveDeviceToken);
router.delete('/device-token',     auth,  c.deleteDeviceToken);

/**
 * @swagger
 * /notifications/status:
 *   get:
 *     tags:
 *       - Notifications
 *     summary: Get notification status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notification status
 */
router.get   ('/status',           auth,  c.status);

module.exports = router;
