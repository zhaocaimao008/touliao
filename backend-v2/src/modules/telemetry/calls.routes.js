'use strict';
/**
 * /api/calls —— 通话质量上报（2026-10-12）
 *   POST /api/calls/:callId/report  （用户鉴权）每用户每通话一行，重复上报覆盖。
 *        先核验上报者参与过该通话（svc.verifyCallParticipation）：持久记录证明不是参与者 → 403；
 *        查无记录 → 照存但 verified=0（统计默认排除）。
 *   GET  /api/calls/stats?days=7[&includeUnverified=1]（后台鉴权）接通率/中继占比/接通耗时中位数，按平台拆分
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
    const participation = svc.verifyCallParticipation(req.user.id, req.params.callId);
    if (participation.verdict === 'rejected') {
      return res.status(403).json({ error: '未参与该通话', error_code: 'NOT_CALL_PARTICIPANT' });
    }
    await svc.saveCallReport(req.user.id, req.params.callId, svc.applyParticipation(row, participation));
    res.json({ success: true, verified: participation.verdict === 'verified' });
  } catch (e) { next(e); }
});

router.get('/stats', adminAuth, (req, res, next) => {
  try {
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
    res.json(svc.callStats(days, { includeUnverified: req.query.includeUnverified === '1' }));
  } catch (e) { next(e); }
});

module.exports = router;
