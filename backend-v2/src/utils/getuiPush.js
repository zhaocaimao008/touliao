'use strict';
/**
 * 个推（GeTui）V2 REST API 推送。
 * 覆盖国产 ROM（小米/华为/OPPO/vivo 等无 GMS 设备），FCM 到不了的地方由个推兜底。
 *
 * 环境变量（生产 .env 配置）：
 *   GETUI_APP_ID / GETUI_APP_KEY / GETUI_MASTER_SECRET
 * 未配置则本模块整体禁用（isEnabled()=false），不影响 FCM。
 *
 * 客户端注册的个推 CID 存到 device_tokens 表，platform='getui'。
 */
const https = require('https');

const APP_ID = process.env.GETUI_APP_ID || '';
const APP_KEY = process.env.GETUI_APP_KEY || '';
const MASTER_SECRET = process.env.GETUI_MASTER_SECRET || '';
const BASE = `https://restapi.getui.com/v2/${APP_ID}`;

function isEnabled() {
  return !!(APP_ID && APP_KEY && MASTER_SECRET);
}

// ── auth token 缓存（个推 token 有效期 24h，提前 1h 刷新）──
let _cachedToken = null;
let _tokenExpireAt = 0;

function sha256(s) {
  return require('crypto').createHash('sha256').update(s).digest('hex');
}

function httpJson(method, path, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const url = new URL(path.startsWith('http') ? path : BASE + path);
    const req = https.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...headers,
      },
      timeout: 10000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: data ? JSON.parse(data) : {} }); }
        catch { resolve({ status: res.statusCode, json: {} }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('getui timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

/** 获取 auth_token（个推鉴权）。sign = sha256(appkey + timestamp + mastersecret）。 */
async function getToken() {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpireAt) return _cachedToken;
  const timestamp = String(now);
  const sign = sha256(APP_KEY + timestamp + MASTER_SECRET);
  const { status, json } = await httpJson('POST', '/auth', {}, { sign, timestamp, appkey: APP_KEY });
  if (status === 200 && json.code === 0 && json.data?.token) {
    _cachedToken = json.data.token;
    _tokenExpireAt = now + 23 * 60 * 60 * 1000; // 23h 后过期，提前刷新
    return _cachedToken;
  }
  throw new Error(`个推鉴权失败: ${JSON.stringify(json)}`);
}

/**
 * 单个 CID 推送透传+通知。
 * @param cid  客户端上报的个推 CID
 * @param title/body  通知标题/正文
 * @param payload  透传数据（点击跳转用），会放进 transmission
 */
async function pushToCid(cid, { title, body, payload }) {
  const token = await getToken();
  const message = {
    request_id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    settings: { ttl: 3600000 },   // 离线保留 1h
    audience: { cid: [cid] },
    push_message: {
      notification: {
        title,
        body,
        click_type: 'intent',
        // 点击打开 App 主界面（各厂商通道统一走 intent）
        intent: `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.vxin.app;component=com.vxin.app/com.vxin.app.MainActivity;S.conversationId=${encodeURIComponent(payload?.conversationId || '')};end`,
      },
    },
    // 透传数据（App 在线时经个推透传，App 可读 conversationId 跳转）
    push_channel: {
      android: {
        ups: {
          notification: { title, body, click_type: 'intent',
            intent: `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.vxin.app;component=com.vxin.app/com.vxin.app.MainActivity;end` },
          // 各厂商离线厂商通道 options（保证锁屏送达）
          options: {
            HW: { '/message/android/notification/importance': 'HIGH' },
            XM: { '/extra.notify_effect': '1' },
          },
        },
      },
    },
  };
  const { status, json } = await httpJson('POST', '/push/single/cid',
    { token }, message);
  return { status, json, cid };
}

module.exports = { isEnabled, pushToCid, getToken };
