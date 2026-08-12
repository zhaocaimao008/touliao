/**
 * P11: 全球部署路由
 * CDN、多区域同步、负载均衡、全球监控
 */
const express = require('express');
const router = express.Router();

const CDNManager = require('../utils/optimization-p11/cdnManager');
const MultiRegionSync = require('../utils/optimization-p11/multiRegionSync');
const GlobalLoadBalancer = require('../utils/optimization-p11/globalLoadBalancer');
const GlobalMonitoring = require('../utils/optimization-p11/globalMonitoring');

// 单例
const cdnManager = new CDNManager();
const multiRegionSync = new MultiRegionSync();
const loadBalancer = new GlobalLoadBalancer();
const monitoring = new GlobalMonitoring();

/**
 * CDN 智能路由
 */
router.post('/cdn/route', (req, res) => {
  const { geoLocation } = req.body;
  const route = cdnManager.routeByGeolocation(req, geoLocation);
  res.json({ route, timestamp: Date.now() });
});

/**
 * 缓存预热
 */
router.post('/cdn/warm', async (req, res) => {
  const { urls } = req.body;
  const result = await cdnManager.warmCache(urls || []);
  res.json(result);
});

/**
 * CDN 缓存统计
 */
router.get('/cdn/stats', (req, res) => {
  res.json(cdnManager.getStats());
});

/**
 * 多区域数据同步
 */
router.post('/sync/data', async (req, res) => {
  const { dataId, data, sourceRegion } = req.body;
  const result = await multiRegionSync.syncData(dataId, data, sourceRegion);
  res.json(result);
});

/**
 * 一致性检查
 */
router.get('/sync/consistency', async (req, res) => {
  const results = await multiRegionSync.verifyConsistency();
  res.json(results);
});

/**
 * 负载均衡 - 选择最优区域
 */
router.post('/balance/select', (req, res) => {
  const { geoLocation, currentLoad } = req.body;
  const region = loadBalancer.selectOptimalRegion(geoLocation, currentLoad);
  res.json(region);
});

/**
 * 负载均衡 - 故障转移
 */
router.post('/balance/failover', async (req, res) => {
  const { failedRegion } = req.body;
  try {
    const newRegion = await loadBalancer.failover(failedRegion);
    res.json({ success: true, newRegion });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

/**
 * 区域健康检查
 */
router.post('/balance/health-check/:region', async (req, res) => {
  const { region } = req.params;
  const healthy = await loadBalancer.healthCheck(region);
  res.json({ region, healthy });
});

/**
 * 负载均衡统计
 */
router.get('/balance/stats', (req, res) => {
  res.json(loadBalancer.getStats());
});

/**
 * 全球监控 - 记录指标
 */
router.post('/monitoring/metric', (req, res) => {
  const { region, metricName, value } = req.body;
  monitoring.recordMetric(region, metricName, value);
  res.json({ recorded: true });
});

/**
 * 全球监控 - 区域报告
 */
router.get('/monitoring/region/:region', (req, res) => {
  const { region } = req.params;
  const report = monitoring.getRegionReport(region);
  res.json(report);
});

/**
 * 全球监控 - 全球状态
 */
router.get('/monitoring/status', (req, res) => {
  const status = monitoring.getGlobalStatus();
  res.json(status);
});

/**
 * 全球监控 - 可用性报告
 */
router.get('/monitoring/availability/:region', (req, res) => {
  const { region } = req.params;
  const availability = monitoring.calculateAvailability(region);
  res.json({ region, availability: `${availability}%` });
});

module.exports = router;
