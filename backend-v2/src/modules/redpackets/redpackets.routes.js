'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { rechargeLimiter, reactLimiter } = require('../../middleware/rateLimiters');
const ctrl = require('./redpackets.controller');

/**
 * @swagger
 * /redpackets/send:
 *   post:
 *     summary: 发红包
 *     tags: [RedPackets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               conversationId: { type: string, description: '对话 ID' }
 *               totalAmount: { type: number, description: '总金币数 (1-20000)' }
 *               totalCount: { type: number, description: '红包个数 (1-100)' }
 *               greeting: { type: string, description: '祝福语 (可选)' }
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 packetId: { type: string }
 *                 message: { type: object }
 */
router.post('/send', auth, rechargeLimiter, ctrl.send);

/**
 * @swagger
 * /redpackets/{packetId}:
 *   get:
 *     summary: 获取红包详情（包括领取记录）
 *     tags: [RedPackets]
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 sender_id: { type: string }
 *                 senderName: { type: string }
 *                 total_amount: { type: number }
 *                 total_count: { type: number }
 *                 claimed_count: { type: number }
 *                 greeting: { type: string }
 *                 claims: { type: array }
 *                 myClaim: { type: object, nullable: true }
 */
router.get('/:packetId', auth, ctrl.detail);

/**
 * @swagger
 * /redpackets/{packetId}/claim:
 *   post:
 *     summary: 领红包
 *     tags: [RedPackets]
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功领取
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 amount: { type: number, description: '领取金币数' }
 *       400:
 *         description: 红包已领完/已过期/已领取过等
 */
router.post('/:packetId/claim', auth, reactLimiter, ctrl.claim);

module.exports = router;
