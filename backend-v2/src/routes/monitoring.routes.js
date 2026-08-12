'use strict';
/**
 * 监控与诊断端点
 */
const express = require('express');
const router = express.Router();
const { redisCache } = require('../integrations/redisCache');
const { tracing } = require('../integrations/tracing');
const { getCdnStatus } = require('../integrations/cdnOptimizer');
const { getStats: getQueryStats } = require('../utils/queryOptimizer');

/**
 * GET /api/monitoring/health
 * 健康检查端点
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
 * 清空 Redis 缓存
 */
router.post('/redis-clear', async (req, res) => {
  try {
    const pattern = req.body.pattern || '*';
    const count = await redisCache.delPattern(pattern);
    res.json({ success: true, deleted: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
