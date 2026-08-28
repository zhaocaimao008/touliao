'use strict';
const { asyncHandler } = require('../../utils/http');
const svc = require('./notifications.service');

exports.vapidPublicKey = asyncHandler(async (req, res) => {
  const key = svc.vapidPublicKey();
  if (!key) return res.status(503).json({ error: 'Web Push 未配置' });
  res.json({ publicKey: key });
});

exports.webSubscribe = asyncHandler(async (req, res) => {
  svc.webSubscribe(req.user.id, req.body.subscription);
  res.json({ success: true });
});
exports.webUnsubscribe = asyncHandler(async (req, res) => {
  svc.webUnsubscribe(req.user.id, req.body.endpoint);
  res.json({ success: true });
});
exports.saveDeviceToken = asyncHandler(async (req, res) => {
  svc.saveDeviceToken(req.user.id, req.body.token, req.body.platform);
  res.json({ success: true });
});
exports.deleteDeviceToken = asyncHandler(async (req, res) => {
  svc.deleteDeviceToken(req.user.id, req.body.token);
  res.json({ success: true });
});
exports.status = asyncHandler(async (req, res) => res.json(svc.status(req.user.id)));

// [诊断] iOS 推送注册诊断上报（临时端点，用于排查 APNs token 不上报）
exports.pushDiag = (req, res) => {
  const body = typeof req.body === 'object' ? req.body : {};
  const line = `[PushDiag ${new Date().toISOString()}] user=${req.user?.id || 'anon'} ip=${req.ip} ${JSON.stringify(body)}`;
  console.log(line);
  try {
    require('fs').appendFileSync('/root/touliao/backend-v2/push-diag.log', line + '\n');
  } catch (e) { /* 日志文件写失败不影响 */ }
  res.json({ ok: true });
};

// [诊断] 个推 GeTui 诊断上报（Android 端 TouliaoApp.initGeTui 直报，带 X-Diag-Token）
exports.getuiDiag = (req, res) => {
  const token = req.get('X-Diag-Token');
  if (token !== 'diag2026') return res.status(403).json({ ok: false, error: 'bad token' });
  const body = typeof req.body === 'object' ? req.body : {};
  const line = `[GeTuiDiag ${new Date().toISOString()}] ip=${req.ip} ${JSON.stringify(body)}`;
  console.log(line);
  try {
    require('fs').appendFileSync('/root/touliao/backend-v2/push-diag.log', line + '\n');
  } catch (e) { /* 日志文件写失败不影响 */ }
  res.json({ ok: true });
};
