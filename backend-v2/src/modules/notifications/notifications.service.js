'use strict';
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const config = require('../../config');
const { badRequest } = require('../../utils/http');
const { isAllowedPushEndpoint } = require('../../utils/push');

function vapidPublicKey() {
  if (!config.vapid.publicKey) return null;
  return config.vapid.publicKey;
}

function webSubscribe(userId, subscription) {
  if (!subscription?.endpoint || typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 2048)
    throw badRequest('订阅信息无效');
  // endpoint 必须来自已知浏览器推送服务域名，防 SSRF（endpoint 指向内网/元数据地址）
  if (!isAllowedPushEndpoint(subscription.endpoint))
    throw badRequest('订阅端点不受支持');
  db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, subscription)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, endpoint) DO UPDATE SET subscription=excluded.subscription
  `).run(uuidv4(), userId, subscription.endpoint, JSON.stringify(subscription));
}

function webUnsubscribe(userId, endpoint) {
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(userId, endpoint);
  else db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(userId);
}

function saveDeviceToken(userId, token, platform) {
  if (!token || typeof token !== 'string' || token.length > 512)
    throw badRequest('token 无效，长度不得超过 512 字符');
  if (!['android', 'ios'].includes(platform)) throw badRequest('参数无效，platform 必须为 android 或 ios');
  db.prepare(`
    INSERT INTO device_tokens (id, user_id, token, platform)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, token) DO UPDATE SET platform=excluded.platform, created_at=(strftime('%s','now'))
  `).run(uuidv4(), userId, token, platform);
}

function deleteDeviceToken(userId, token) {
  if (token) db.prepare('DELETE FROM device_tokens WHERE user_id=? AND token=?').run(userId, token);
  else db.prepare('DELETE FROM device_tokens WHERE user_id=?').run(userId);
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
