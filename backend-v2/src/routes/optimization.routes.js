'use strict';
/**
 * P4 优化特性 API 路由 (P4.3-P4.7)
 * 搜索排序 + 批量 ACK + 消息去重 + 缓存预热 + 网络感知重试
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { badRequest, forbidden } = require('../utils/http');
const { requireMessageAccess } = require('../utils/messageAuthorization');
const { pagination } = require('../utils/pagination');

// 搜索排序 / 建议的输入边界：query、prefix 为有限长度字符串，待排序消息与建议条数有上限。
const MAX_QUERY_LENGTH = 100;
const MAX_RANK_MESSAGES = 500;
const MAX_SUGGESTIONS = 20;
function searchText(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > MAX_QUERY_LENGTH || (!allowEmpty && !value.trim())) {
    throw badRequest(`${name} 必须是 1-${MAX_QUERY_LENGTH} 字的字符串`);
  }
  return value;
}

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
    const { messages } = req.body;
    const query = searchText(req.body.query, 'query');
    if (!Array.isArray(messages) || messages.length > MAX_RANK_MESSAGES) {
      throw badRequest(`messages 必须是最多 ${MAX_RANK_MESSAGES} 条的数组`);
    }
    const searchRanking = req.app.get('searchRanking');

    if (!searchRanking) {
      throw badRequest('搜索排序引擎未初始化');
    }

    // 只记录本人的搜索历史（供本人的建议使用）。不再写入、也不再返回全站热词：
    // 热词由其他用户的原始搜索词构成，返回给任意登录用户会泄露他人搜索内容。
    await searchRanking.recordUserSearch(req.user.id, query);

    const ranked = searchRanking.rankResults(messages, query);

    res.json({
      results: ranked,
      count: ranked.length,
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
    const prefix = searchText(req.query.prefix === undefined ? '' : req.query.prefix, 'prefix', { allowEmpty: true });
    const { limit } = pagination({ limit: req.query.limit === undefined ? 5 : req.query.limit }, MAX_SUGGESTIONS);
    const searchRanking = req.app.get('searchRanking');
    if (!searchRanking) {
      throw badRequest('搜索排序引擎未初始化');
    }

    const suggestions = await searchRanking.getSearchSuggestions(req.user.id, prefix, limit);

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
    if (!Array.isArray(deliveries) || !Array.isArray(reads) || deliveries.length + reads.length > 500) {
      throw badRequest('每批最多 500 条消息');
    }
    for (const messageId of new Set([...deliveries, ...reads])) requireMessageAccess(messageId, req.user.id);
    const batchAckManager = req.app.get('batchAckManager');

    if (!batchAckManager) {
      throw badRequest('批量 ACK 管理器未初始化');
    }

    const results = {
      deliveries: await batchAckManager.batchRecordDelivery(req.user.id, deliveries),
      reads: await batchAckManager.batchRecordRead(req.user.id, reads),
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
router.post('/ack/flush', adminAuth, async (req, res, next) => {
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
router.post('/cache/warm', adminAuth, async (req, res, next) => {
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
    if (userId !== req.user.id) throw forbidden('只能预热自己的数据');
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
router.get('/stats', adminAuth, async (req, res, next) => {
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
