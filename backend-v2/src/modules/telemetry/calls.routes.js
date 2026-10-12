'use strict';
/**
 * /api/calls —— 通话质量上报（2026-10-12）
 *   POST /api/calls/:callId/report  （用户鉴权）每用户每通话一行，重复上报覆盖
 *   GET  /api/calls/stats?days=7    （后台鉴权）接通率/中继占比/接通耗时中位数，按平台拆分
 */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const auth = require('../../middleware/auth');
const adminAuth = require('../../middleware/adminAuth');
const svc = require('./telemetry.service');

// 单用户 10 分钟 30 次（正常一通电话一次，挂断重试/多端也远够用）
const reportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => req.user.id,
  skip: () => process.env.DISABLE_RATE_LIMIT === '1',
  handler: (req, res) => res.status(429).json({ error: '上报过于频繁', error_code: 'RATE_LIMITED' }),
  validate: { xForwardedForHeader: false },
});

const CALL_ID = /^[A-Za-z0-9_-]{1,64}$/;

router.post('/:callId/report', auth, reportLimiter, async (req, res, next) => {
  try {
    if (!CALL_ID.test(req.params.callId)) return res.status(400).json({ error: 'callId 非法', error_code: 'BAD_REQUEST' });
    const { error, row } = svc.normalizeCallReport(req.body);
    if (error) return res.status(400).json({ error, error_code: 'BAD_REQUEST' });
    await svc.saveCallReport(req.user.id, req.params.callId, row);
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.get('/stats', adminAuth, (req, res, next) => {
  try {
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
    res.json(svc.callStats(days));
  } catch (e) { next(e); }
});

module.exports = router;
