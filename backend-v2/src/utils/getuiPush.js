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
 * 推送发送的瞬时失败重试。
 *
 * 背景：此前 push/single/cid 一旦超时或网络抖动就直接失败，调用方 utils/push.js
 * 只 `.catch(e => console.warn('[push] 个推异常: ...'))` 静默丢弃——用户那一条通知
 * 就此没了，没有任何重试。生产日志实测 2026-09-03 14:05~14:26 有 8 次
 * `个推异常: getui timeout`，即 8 条安卓通知无声丢失。
 *
 * 为什么重试是安全的：个推以 message.request_id 做幂等去重。这里刻意复用**同一个**
 * message 对象（request_id 在构造时生成一次、重试不重新生成），所以「首次请求其实
 * 已经到达个推、只是响应超时」这种情况重试也不会重复推送给用户。
 *
 * 只重试瞬时失败（超时/连接错误/5xx）。业务层拒绝（4xx、code!=0，如 CID 失效）
 * 是确定性结果，重试没有意义，直接返回给调用方按原逻辑处理。
 * 只重试 1 次、退避 800ms：通知的时效性本身有限（来电尤其），拖太久还不如不推。
 */
const PUSH_MAX_ATTEMPTS = 2;
const PUSH_RETRY_DELAY_MS = 800;

function isTransient(err, res) {
  if (err) return true;                       // 超时 / ECONNRESET / DNS 等
  return res && res.status >= 500;            // 个推侧 5xx
}

// send / delayMs 可注入纯粹为了可测（默认即真实实现）：这段逻辑要钉死的两条不变量
// ——「瞬时失败才重试」与「重试复用同一 request_id」——不该为了验证它们去 mock https。
async function sendPushWithRetry(path, token, message, { send = httpJson, delayMs = PUSH_RETRY_DELAY_MS } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= PUSH_MAX_ATTEMPTS; attempt += 1) {
    let res = null, err = null;
    try {
      res = await send('POST', path, { token }, message);
    } catch (e) {
      err = e;
    }
    if (!isTransient(err, res)) return res;
    lastErr = err || new Error(`getui http ${res.status}`);
    if (attempt < PUSH_MAX_ATTEMPTS) {
      console.warn(`[getui] 瞬时失败，${delayMs}ms 后重试(${attempt}/${PUSH_MAX_ATTEMPTS - 1}): ${lastErr.message}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/**
 * 单个 CID 推送透传+通知。
 * @param cid  客户端上报的个推 CID
 * @param title/body  通知标题/正文
 * @param payload  透传数据（点击跳转用），会放进 transmission
 */
async function pushToCid(cid, { title, body, payload }) {
  const token = await getToken();
  // transmission（透传）格式与 VxinGeTuiService.onReceiveMessageData 解析约定一致：
  // {"title":"...","body":"...","conversationId":"..."}
  // App 在线时走透传 → onReceiveMessageData → showMessageNotification（使用 vxin_messages_v3 渠道）
  // App 离线/后台时走 push_channel.ups.notification → 厂商通道直接展示
  const transmissionPayload = JSON.stringify({
    title,
    body,
    type: payload?.type || '',      // 事件类型（message/call/friend_request…），客户端据此区分展示/跳转（NOTIFY-004 P1-2）
    conversationId: payload?.conversationId || '',
    senderId: payload?.senderId || '',
  });
  const message = {
    request_id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    settings: { ttl: 3600000 },   // 离线保留 1h
    audience: { cid: [cid] },
    // transmission 取代 notification：避免个推 SDK 用默认渠道展示通知，
    // 改由客户端 onReceiveMessageData 以 vxin_messages_v3 渠道展示，保证锁屏可见性正确。
    push_message: {
      transmission: transmissionPayload,
    },
    // App 离线/后台：厂商通道展示（需在个推控制台配置各厂商 Key）
    // 点击 intent 带 conversationId extra，与 NotificationHelper.EXTRA_CONVERSATION_ID
    // ("conversationId") 一致，使国产 ROM 被杀场景（透传回调不可达）点击也能直接进会话，
    // 而不是只打开主页。package/component 须为真实 applicationId（此前误写成 vxin 母版遗留的
    // com.vxin.app，导致系统根本解析不到组件、厂商通道通知点击完全无响应）。
    push_channel: {
      android: {
        ups: {
          notification: { title, body, click_type: 'intent',
            intent: `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.touliao.app;component=com.touliao.app/com.touliao.app.MainActivity;${payload?.conversationId ? `S.conversationId=${encodeURIComponent(payload.conversationId)};` : ''}end` },
          // 各厂商离线厂商通道 options（保证锁屏送达）
          options: {
            HW: { '/message/android/notification/importance': 'HIGH' },
            XM: { '/extra.notify_effect': '1' },
          },
        },
      },
    },
  };
  const { status, json } = await sendPushWithRetry('/push/single/cid', token, message);
  return { status, json, cid };
}

/**
 * 来电推送（国产 ROM 无 GMS 兜底，pushCallInvite 复用）：
 *  - 透传 transmission type='call'：App 进程活着（前台/后台）时 onReceiveMessageData 收到，
 *    客户端据此弹 fullScreenIntent 全屏来电（与 FCM data-only type=call 同款界面）。
 *  - 厂商通道 ups.notification：App 被杀时由厂商系统展示来电通知，点击 intent 带
 *    callId/callFrom/callerName/callType（与 NotificationHelper.EXTRA_CALL_* 键名对齐），
 *    MainActivity 识别后重建来电界面（被杀场景兜底，无法全屏但保证可见+可点接听）。
 */
async function pushCallToCid(cid, { callId, from, callerName, callType }) {
  const token = await getToken();
  const t = callType === 'video' ? 'video' : 'audio';
  const title = callerName || '来电';
  const body = t === 'video' ? '邀请你视频通话' : '邀请你语音通话';
  // 透传字段与 FCM data-only 对齐（type/callId/from/callerName/callType），
  // 客户端 TouliaoGeTuiService 按同一套键名解析，可复用 showCallNotification。
  const transmissionPayload = JSON.stringify({
    title, body,
    type: 'call',
    callId: String(callId || ''),
    from: String(from || ''),
    callerName: String(callerName || ''),
    callType: t,
  });
  const message = {
    request_id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    settings: { ttl: 3600000 },   // 离线保留 1h（与 pushToCid 一致）
    audience: { cid: [cid] },
    push_message: { transmission: transmissionPayload },
    // App 被杀场景：厂商通道通知（需个推控制台配置各厂商 Key，同 pushToCid）
    push_channel: {
      android: {
        ups: {
          notification: {
            title, body,
            click_type: 'intent',
            // 键名须与 NotificationHelper.EXTRA_CALL_ID/FROM/NAME/TYPE 一致：
            // callId / callFrom / callerName / callType（注意 from 在 intent 里是 callFrom）
            intent: `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.touliao.app;component=com.touliao.app/com.touliao.app.MainActivity;S.callId=${encodeURIComponent(callId || '')};S.callFrom=${encodeURIComponent(from || '')};S.callerName=${encodeURIComponent(callerName || '')};S.callType=${t};end`,
          },
          options: {
            HW: { '/message/android/notification/importance': 'HIGH' },
            XM: { '/extra.notify_effect': '1' },
          },
        },
      },
    },
  };
  // 来电推送同样走瞬时失败重试（复用同一 request_id，个推按它幂等去重，不会重复响铃）。
  // 来电时效性最强，退避仍是 800ms、只重试 1 次——见 sendPushWithRetry 注释。
  const { status, json } = await sendPushWithRetry('/push/single/cid', token, message);
  // 此前只要 HTTP 请求本身没抛异常就当成功返回——个推 API 常见的是 HTTP 200 但
  // json.code!==0 的业务失败（cid 过期/未配置厂商 Key/离线保留超限等），调用方
  // （push.js 的 pushCallInvite）只在 promise reject 时才 console.warn，这种"响应体
  // 里的失败"被完全吞掉，永远不会出现在日志里——排查"来电推送不到"时无从下手。
  // 加这道校验后，业务失败会 throw，push.js 现有的 .catch 会把 json 原样打进日志。
  if (status !== 200 || json.code !== 0) {
    throw new Error(`个推来电推送失败 status=${status} ${JSON.stringify(json)}`);
  }
  return { status, json, cid };
}

module.exports = { isEnabled, pushToCid, pushCallToCid, getToken, sendPushWithRetry, PUSH_MAX_ATTEMPTS };
