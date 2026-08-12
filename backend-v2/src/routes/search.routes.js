'use strict';
/**
 * 搜索 API 路由 (P4.1)
 * 端点: /api/search
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { badRequest } = require('../utils/http');
const searchService = require('../modules/messages/search.service');

/**
 * @swagger
 * /api/search/messages:
 *   get:
 *     summary: 在指定会话中搜索消息
 *     tags: [Search]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *         description: 会话 ID
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: 搜索查询（最少 1 字，最多 100 字）
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: senderOnly
 *         schema: { type: string }
 *         description: 仅返回指定用户的消息
 *     responses:
 *       200:
 *         description: 搜索结果
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results: { type: array }
 *                 total: { type: integer }
 *                 took: { type: integer }
 *                 fromCache: { type: boolean }
 */
router.get('/messages', auth, async (req, res, next) => {
  try {
    const { conversationId, q, limit, offset, senderOnly } = req.query;
    const userId = req.user.id;

    if (!conversationId || !q) {
      throw badRequest('缺少必要参数: conversationId, q');
    }

    const result = await searchService.searchInConversation(
      conversationId,
      userId,
      q,
      {
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0,
        senderOnly,
      }
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/search/global:
 *   get:
 *     summary: 全局搜索（所有会话）
 *     tags: [Search]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: 搜索查询
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: 搜索结果
 */
router.get('/global', auth, async (req, res, next) => {
  try {
    const { q, limit, offset } = req.query;
    const userId = req.user.id;

    if (!q) {
      throw badRequest('缺少查询参数: q');
    }

    const result = await searchService.searchGlobal(userId, q, {
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/search/stats:
 *   get:
 *     summary: 获取会话搜索统计
 *     tags: [Search]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 统计信息
 */
router.get('/stats', auth, async (req, res, next) => {
  try {
    const { conversationId } = req.query;
    
    if (!conversationId) {
      throw badRequest('缺少参数: conversationId');
    }

    const stats = searchService.getConversationSearchStats(conversationId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
