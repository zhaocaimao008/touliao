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

// ── [诊断] 推送注册诊断上报 ────────────────────────────────────────────
// 这两个端点是临时排查用的（iOS APNs token 不上报 / 安卓个推注册），2026-09-04 加固：
//
//  1) getuiDiag 此前用源码里硬编码的 'diag2026' 当唯一凭据，且挂在 /api CSRF 与鉴权
//     之前（app.js）。这个串既在仓库里，也随 Android APK 发出去，等于公开——
//     任何人都能无鉴权 POST 进来。
//  2) 每次请求都 appendFileSync 把**攻击者可控**的 JSON 追加进文件：同步写阻塞事件
//     循环、文件无上限增长、内容未截断（日志注入）。合起来是一条无鉴权的低成本 DoS。
//  3) 写死绝对路径 /root/touliao/backend-v2/push-diag.log，换任何部署路径都写不进去。
//
// 改为：默认关闭（未配 PUSH_DIAG_TOKEN 即 404，线上默认就没有这个面），
// 需要排查时才在 .env 配一个随机 token 打开；路径改用 logger 同款 logs/ 目录；
// 单条截断、文件超过上限就停止写入。
const fs = require('fs');
const path = require('path');

const DIAG_TOKEN = process.env.PUSH_DIAG_TOKEN || '';
const DIAG_ENABLED = DIAG_TOKEN.length > 0;
const DIAG_LOG = path.join(__dirname, '../../../logs', 'push-diag.log');
const DIAG_MAX_LINE = 1024;              // 单条最长，超出截断（防日志注入/撑爆）
const DIAG_MAX_FILE = 5 * 1024 * 1024;   // 文件上限 5MB，到顶即停写

function appendDiag(line) {
  const safe = line.replace(/[\r\n]+/g, ' ').slice(0, DIAG_MAX_LINE);
  console.log(safe);
  try {
    if (fs.existsSync(DIAG_LOG) && fs.statSync(DIAG_LOG).size > DIAG_MAX_FILE) return;
    fs.appendFileSync(DIAG_LOG, safe + '\n');
  } catch { /* 诊断日志写失败绝不影响主流程 */ }
}

// iOS 推送注册诊断上报（走 /api/notifications/push-diag，已有 auth 中间件）
exports.pushDiag = (req, res) => {
  if (!DIAG_ENABLED) return res.status(404).json({ error: 'Not found' });
  const body = typeof req.body === 'object' ? req.body : {};
  appendDiag(`[PushDiag ${new Date().toISOString()}] user=${req.user?.id || 'anon'} ip=${req.ip} ${JSON.stringify(body)}`);
  res.json({ ok: true });
};

// 个推 GeTui 诊断上报（Android 端直报，挂在 /api CSRF 与鉴权之前，只有这个 token 挡着）
exports.getuiDiag = (req, res) => {
  if (!DIAG_ENABLED) return res.status(404).json({ error: 'Not found' });
  // 时长恒定比较，避免按字节试探 token
  const supplied = Buffer.from(String(req.get('X-Diag-Token') || ''));
  const expected = Buffer.from(DIAG_TOKEN);
  const okToken = supplied.length === expected.length
    && require('crypto').timingSafeEqual(supplied, expected);
  if (!okToken) return res.status(403).json({ ok: false, error: 'bad token' });
  const body = typeof req.body === 'object' ? req.body : {};
  appendDiag(`[GeTuiDiag ${new Date().toISOString()}] ip=${req.ip} ${JSON.stringify(body)}`);
  res.json({ ok: true });
};
