'use strict';
/**
 * 对客户端公开的 features：后台开关（admin.service getFeatures）+ 服务端能力位（由 .env 决定）。
 * GET /api/config 与后台改开关后的 socket 广播 config:updated 必须用同一份——web 端
 * setPublicFeatures 整体替换已存 features，广播若缺能力位，在线客户端会丢掉
 * cloudUpload:false / webPush:false，重新去探测 /api/upload/credential 等（又是一串 503）。
 *   features.cloudUpload === false → 不调 /api/upload/credential，直接走本机上传；
 *   features.webPush === false     → 不取 /api/notifications/vapid-public-key、不做 Web Push 订阅。
 * 依赖按需 require，避免与 admin/notifications 模块形成加载环。
 */
function publicFeatures() {
  const { getFeatures } = require('../modules/admin/admin.service');
  const { isConfigured } = require('./cloudStorage');
  const { vapidPublicKey } = require('../modules/notifications/notifications.service');
  return { ...getFeatures(), cloudUpload: !!isConfigured(), webPush: !!vapidPublicKey() };
}

module.exports = { publicFeatures };
