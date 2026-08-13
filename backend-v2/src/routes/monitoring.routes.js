'use strict';
/**
 * 监控与诊断端点
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// /health 无需鉴权（给监控探针/负载均衡使用）
// 注：详细系统诊断数据（内存/Redis/tracing）需登录，见下方各端点。
// 公开轻量探针见 app.js /health（仅 SELECT 1）。

const { redisCache } = require('../integrations/redisCache');
const { tracing } = require('../integrations/tracing');
const { getCdnStatus } = require('../integrations/cdnOptimizer');
const { getStats: getQueryStats } = require('../utils/queryOptimizer');

// 以下端点需要登录
router.use(auth);

/**
 * GET /api/monitoring/health
 * 详细健康检查端点（含内存/Redis/tracing/CDN，需鉴权）
 */
router.get('/health', (req, res) => {
  const redisStats = redisCache.getStats();
  const tracingStats = tracing.getInMemoryStats();

  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    redis: {
      connected: redisStats.isConnected,
      hitRate: redisStats.hitRate,
      operations: {
        hits: redisStats.hits,
        misses: redisStats.misses,
        sets: redisStats.sets,
      },
    },
    tracing: {
      enabled: tracing.isEnabled,
      spans: {
        total: tracingStats.total,
        completed: tracingStats.completed,
        avgDuration: tracingStats.avgDuration,
      },
    },
    cdn: getCdnStatus(),
  };

  res.json(health);
});


/**
 * GET /api/monitoring/redis-stats
 * Redis 缓存统计
 */
router.get('/redis-stats', (req, res) => {
  res.json(redisCache.getStats());
});

/**
 * GET /api/monitoring/tracing-stats
 * 追踪统计
 */
router.get('/tracing-stats', (req, res) => {
  res.json(tracing.getInMemoryStats());
});

/**
 * GET /api/monitoring/query-stats
 * 查询优化统计
 */
router.get('/query-stats', (req, res) => {
  res.json(getQueryStats());
});

/**
 * POST /api/monitoring/redis-clear
 * 清空 Redis 缓存（仅后台管理员）
 */
router.post('/redis-clear', adminAuth, async (req, res) => {
  try {
    const pattern = req.body.pattern || '*';
    const count = await redisCache.delPattern(pattern);
    res.json({ success: true, deleted: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
