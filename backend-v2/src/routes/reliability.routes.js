'use strict';
/**
 * 消息可靠性管理 API 路由 (P4.2)
 * 端点: /api/reliability
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { badRequest } = require('../utils/http');
const { requireMessageAccess } = require('../utils/messageAuthorization');
const { db } = require('../db/connection');

/**
 * @swagger
 * /api/reliability/ack/delivery:
 *   post:
 *     summary: 记录消息送达确认
 *     tags: [Reliability]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messageId]
 *             properties:
 *               messageId: { type: string }
 *               timestamp: { type: integer }
 *     responses:
 *       200:
 *         description: 确认已记录
 */
router.post('/ack/delivery', auth, async (req, res, next) => {
  try {
    const { messageId, timestamp } = req.body;
    const userId = req.user.id;

    if (!messageId) {
      throw badRequest('缺少参数: messageId');
    }

    requireMessageAccess(messageId, userId);
    const ackManager = req.app.get('ackManager');
    await ackManager.recordDelivery(messageId, userId, timestamp || Date.now());

    res.json({ ok: true, message: '送达确认已记录' });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/reliability/ack/read:
 *   post:
 *     summary: 记录消息已读确认
 *     tags: [Reliability]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messageId]
 *             properties:
 *               messageId: { type: string }
 *               timestamp: { type: integer }
 *     responses:
 *       200:
 *         description: 确认已记录
 */
router.post('/ack/read', auth, async (req, res, next) => {
  try {
    const { messageId, timestamp } = req.body;
    const userId = req.user.id;

    if (!messageId) {
      throw badRequest('缺少参数: messageId');
    }

    requireMessageAccess(messageId, userId);
    const ackManager = req.app.get('ackManager');
    await ackManager.recordRead(messageId, userId, timestamp || Date.now());
    const msg = requireMessageAccess(messageId, userId);

    // 持久化到 SQLite（三态展示的最终态；Redis 仅实时缓存，TTL 过期不丢）
    db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)').run(messageId, userId);

    const rowid = db.prepare('SELECT rowid AS rid FROM messages WHERE id=?').get(messageId)?.rid;
    if (rowid != null) require('../modules/messages/burn.service').recordRead(req.app.get('io'), userId, msg.conversation_id, rowid, messageId);

    // 向发送者实时广播精确回执（消息气泡 蓝双勾 即时流转）
    if (msg && msg.sender_id !== userId) {
      req.app.get('io')?.to(`user_${msg.sender_id}`).emit('message:read', {
        messageId, readBy: userId, conversationId: msg.conversation_id,
      });
    }

    res.json({ ok: true, message: '已读确认已记录' });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/reliability/ack/status:
 *   get:
 *     summary: 获取消息 ACK 状态
 *     tags: [Reliability]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: ACK 状态
 */
router.get('/ack/status', auth, async (req, res, next) => {
  try {
    const { messageId } = req.query;

    if (!messageId) {
      throw badRequest('缺少参数: messageId');
    }

    requireMessageAccess(messageId, req.user.id);
    const ackManager = req.app.get('ackManager');
    const status = await ackManager.getMessageAckStatus(messageId);

    res.json(status);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/reliability/queue/stats:
 *   get:
 *     summary: 获取消息队列统计
 *     tags: [Reliability]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: queueName
 *         schema: { type: string, default: 'messages' }
 *     responses:
 *       200:
 *         description: 队列统计
 */
router.get('/queue/stats', adminAuth, async (req, res, next) => {
  try {
    const { queueName = 'messages' } = req.query;

    const msgQueue = req.app.get('msgQueue');
    const stats = await msgQueue.getQueueStats(queueName);

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/reliability/dlq:
 *   get:
 *     summary: 查看死信队列
 *     tags: [Reliability]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: queueName
 *         schema: { type: string, default: 'messages' }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: DLQ 消息列表
 */
router.get('/dlq', adminAuth, async (req, res, next) => {
  try {
    const { queueName = 'messages', limit = 50 } = req.query;
    if (typeof queueName !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(queueName)
      || !Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100) throw badRequest('队列参数无效');

    const msgQueue = req.app.get('msgQueue');
    const messages = await msgQueue.getDLQMessages(queueName, parseInt(limit));

    res.json({ queueName, messages, count: messages.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
