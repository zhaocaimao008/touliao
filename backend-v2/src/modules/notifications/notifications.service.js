'use strict';
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const config = require('../../config');
const { badRequest, unauthorized } = require('../../utils/http');
const { isAllowedPushEndpoint } = require('../../utils/push');

function vapidPublicKey() {
  if (!config.vapid.publicKey) return null;
  return config.vapid.publicKey;
}

function checkSession(userId, sessionId) {
  if (sessionId && !db.prepare('SELECT 1 FROM auth_sessions WHERE id=? AND user_id=?').get(sessionId, userId))
    throw unauthorized('登录会话已失效，请重新登录');
}

function webSubscribe(userId, subscription, sessionId = null) {
  if (!subscription?.endpoint || typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 2048)
    throw badRequest('订阅信息无效');
  // endpoint 必须来自已知浏览器推送服务域名，防 SSRF（endpoint 指向内网/元数据地址）
  if (!isAllowedPushEndpoint(subscription.endpoint))
    throw badRequest('订阅端点不受支持');
  db.transaction(() => {
    checkSession(userId, sessionId);
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id<>?').run(subscription.endpoint, userId);
    db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, subscription, session_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, endpoint) DO UPDATE SET subscription=excluded.subscription, session_id=excluded.session_id, created_at=(strftime('%s','now'))
  `).run(uuidv4(), userId, subscription.endpoint, JSON.stringify(subscription), sessionId);
  })();
}

function webUnsubscribe(userId, endpoint, sessionId = null) {
  db.prepare(`DELETE FROM push_subscriptions WHERE user_id=? AND (? IS NULL OR session_id=? OR session_id IS NULL)
    AND (? IS NULL OR endpoint=?)`).run(userId, sessionId, sessionId, endpoint || null, endpoint || null);
}

function saveDeviceToken(userId, token, platform, sessionId = null) {
  if (!token || typeof token !== 'string' || token.length > 512)
    throw badRequest('token 无效，长度不得超过 512 字符');
  // getui = 国产 ROM 的个推 CID（无 GMS 设备靠它兜底锁屏推送）。此前漏了 getui，
  // 导致个推 CID 注册被 400 拒绝、永远存不进库 → getuiPush 的 WHERE platform='getui'
  // 查询恒空 → 国产 ROM 锁屏推送从未生效。
  // ios_apns = iOS 原始 APNs device token（64 位 hex），后端直连 APNs 用它发送，
  // 不依赖 Firebase 控制台 APNs 密钥配置（无人值守环境传不了密钥,FCM→APNs 永远失败）。
  if (!['android', 'ios', 'ios_voip', 'getui', 'ios_apns'].includes(platform)) throw badRequest('参数无效，platform 必须为 android、ios、ios_voip、getui 或 ios_apns');
  db.transaction(() => {
    checkSession(userId, sessionId);
    db.prepare('DELETE FROM device_tokens WHERE token=? AND user_id<>?').run(token, userId);
    db.prepare(`
    INSERT INTO device_tokens (id, user_id, token, platform, session_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, token) DO UPDATE SET platform=excluded.platform, session_id=excluded.session_id, created_at=(strftime('%s','now'))
  `).run(uuidv4(), userId, token, platform, sessionId);
  })();
}

function deleteDeviceToken(userId, token, sessionId = null) {
  db.prepare(`DELETE FROM device_tokens WHERE user_id=? AND (? IS NULL OR session_id=? OR session_id IS NULL)
    AND (? IS NULL OR token=?)`).run(userId, sessionId, sessionId, token || null, token || null);
}

function status(userId) {
  const webSubs = db.prepare('SELECT endpoint, created_at FROM push_subscriptions WHERE user_id=?').all(userId);
  const devices = db.prepare('SELECT platform, created_at FROM device_tokens WHERE user_id=?').all(userId);
  return {
    webPush: { enabled: !!config.vapid.publicKey, subscriptions: webSubs.length },
    fcm:     { enabled: !!process.env.FIREBASE_PROJECT_ID, devices: devices.length },
    detail:  { webSubs, devices },
  };
}

module.exports = { vapidPublicKey, webSubscribe, webUnsubscribe, saveDeviceToken, deleteDeviceToken, status };
