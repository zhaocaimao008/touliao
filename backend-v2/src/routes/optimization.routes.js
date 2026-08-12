'use strict';
/**
 * P4 优化特性 API 路由 (P4.3-P4.7)
 * 搜索排序 + 批量 ACK + 消息去重 + 缓存预热 + 网络感知重试
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { badRequest } = require('../utils/http');

/**
 * @swagger
 * /api/optimization/search/rank:
 *   post:
 *     summary: 搜索结果排序 (P4.3)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messages, query]
 *             properties:
 *               messages: { type: array }
 *               query: { type: string }
 *     responses:
 *       200:
 *         description: 排序后的消息
 */
router.post('/search/rank', auth, async (req, res, next) => {
  try {
    const { messages, query } = req.body;
    const searchRanking = req.app.get('searchRanking');
    
    if (!searchRanking) {
      throw badRequest('搜索排序引擎未初始化');
    }

    // 记录搜索查询
    await searchRanking.recordSearch(query);
    await searchRanking.recordUserSearch(req.user.id, query);

    // 排序结果
    const ranked = searchRanking.rankResults(messages, query);

    res.json({
      results: ranked,
      count: ranked.length,
      trending: await searchRanking.getSearchTrending(10),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/optimization/search/suggestions:
 *   get:
 *     summary: 获取搜索建议 (P4.3)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: prefix
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 5 }
 */
router.get('/search/suggestions', auth, async (req, res, next) => {
  try {
    const { prefix = '', limit = 5 } = req.query;
    const searchRanking = req.app.get('searchRanking');

    const suggestions = await searchRanking.getSearchSuggestions(
      req.user.id,
      prefix,
      parseInt(limit)
    );

    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/optimization/ack/batch:
 *   post:
 *     summary: 批量 ACK 确认 (P4.5)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deliveries: { type: array, items: { type: string } }
 *               reads: { type: array, items: { type: string } }
 */
router.post('/ack/batch', auth, async (req, res, next) => {
  try {
    const { deliveries = [], reads = [] } = req.body;
    const batchAckManager = req.app.get('batchAckManager');

    if (!batchAckManager) {
      throw badRequest('批量 ACK 管理器未初始化');
    }

    const results = {
      deliveries: await batchAckManager.batchRecordDelivery(req.user.id, deliveries),
      reads: await batchAckManager.batchRecordRead(req.user.id, reads),
      stats: batchAckManager.getStats(),
    };

    res.json(results);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/optimization/ack/flush:
 *   post:
 *     summary: 强制刷新待处理 ACK 批次 (P4.5)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/ack/flush', auth, async (req, res, next) => {
  try {
    const batchAckManager = req.app.get('batchAckManager');

    if (!batchAckManager) {
      throw badRequest('批量 ACK 管理器未初始化');
    }

    const results = await batchAckManager.flushAll();
    res.json({ flushed: results, stats: batchAckManager.getStats() });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/optimization/dedup/check:
 *   post:
 *     summary: 检查消息重复 (P4.4)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientMsgId]
 *             properties:
 *               clientMsgId: { type: string }
 */
router.post('/dedup/check', auth, async (req, res, next) => {
  try {
    const { clientMsgId } = req.body;
    const deduplicator = req.app.get('deduplicator');

    if (!deduplicator) {
      throw badRequest('去重管理器未初始化');
    }

    const isDuplicate = await deduplicator.isDuplicate(req.user.id, clientMsgId);
    const metadata = await deduplicator.getProcessedMetadata(req.user.id, clientMsgId);

    res.json({
      isDuplicate,
      metadata,
      stats: await deduplicator.getStats(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/optimization/dedup/mark:
 *   post:
 *     summary: 标记消息已处理 (P4.4)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientMsgId]
 *             properties:
 *               clientMsgId: { type: string }
 */
router.post('/dedup/mark', auth, async (req, res, next) => {
  try {
    const { clientMsgId, metadata = {} } = req.body;
    const deduplicator = req.app.get('deduplicator');

    if (!deduplicator) {
      throw badRequest('去重管理器未初始化');
    }

    await deduplicator.markProcessed(req.user.id, clientMsgId, metadata);
    res.json({ ok: true, message: '消息已标记' });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/optimization/cache/warm:
 *   post:
 *     summary: 触发缓存预热 (P4.6)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/cache/warm', auth, async (req, res, next) => {
  try {
    const cacheWarmer = req.app.get('cacheWarmer');

    if (!cacheWarmer) {
      throw badRequest('缓存预热器未初始化');
    }

    // 异步执行，不阻塞响应
    const results = await cacheWarmer.warmAll();

    res.json({
      status: 'warming',
      results,
      estimatedTime: results.duration,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/optimization/cache/warm-user:
 *   post:
 *     summary: 预热特定用户数据 (P4.6)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId: { type: string }
 */
router.post('/cache/warm-user', auth, async (req, res, next) => {
  try {
    const { userId } = req.body;
    const cacheWarmer = req.app.get('cacheWarmer');

    if (!cacheWarmer) {
      throw badRequest('缓存预热器未初始化');
    }

    const result = await cacheWarmer.warmUserData(userId);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/optimization/network/quality:
 *   get:
 *     summary: 获取网络质量信息 (P4.7)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/network/quality', auth, async (req, res, next) => {
  try {
    const networkAware = req.app.get('networkAware');

    if (!networkAware) {
      throw badRequest('网络感知重试器未初始化');
    }

    const config = networkAware.getConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/optimization/network/detect:
 *   post:
 *     summary: 检测网络质量 (P4.7)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/network/detect', auth, async (req, res, next) => {
  try {
    const networkAware = req.app.get('networkAware');

    if (!networkAware) {
      throw badRequest('网络感知重试器未初始化');
    }

    const quality = await networkAware.detectNetworkQuality();
    res.json({
      quality,
      config: networkAware.retryConfigs[quality],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/optimization/stats:
 *   get:
 *     summary: 获取所有优化统计信息 (P4)
 *     tags: [Optimization]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/stats', auth, async (req, res, next) => {
  try {
    const stats = {
      searchRanking: req.app.get('searchRanking')?.getSearchTrending ? 'ready' : 'offline',
      batchAck: req.app.get('batchAckManager')?.getStats?.() || {},
      dedup: await req.app.get('deduplicator')?.getStats?.() || {},
      cacheWarmer: 'ready',
      networkAware: req.app.get('networkAware')?.getConfig?.() || {},
    };

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
