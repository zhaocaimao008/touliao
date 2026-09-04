'use strict';
/**
 * 推送服务：Web Push (VAPID) + FCM/APNs (firebase-admin) + 个推 GeTui（国产 ROM）。
 * pushNewMessage 向会话内、非发送者的所有成员推送，
 * 并按各自的免打扰/详情预览/声音/震动设置定制 payload。
 * 推送优先级：FCM（GMS 设备）+ 个推（国产 ROM）并行，互不干扰。
 */
const http2 = require('http2');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const config = require('../config');
const { db } = require('../db/connection');
const getuiPush = require('./getuiPush');
const pushI18n = require('./pushI18n');
const fcmOptimized = require('./fcmOptimized');  // 新增：Android FCM 优化模块

// Web Push endpoint 只可能来自浏览器推送服务(FCM/Mozilla/Apple/WNS)。限制到已知服务域名，
// 防 SSRF——攻击者若把订阅 endpoint 指向内网/云元数据地址(如 http://169.254.169.254、
// http://localhost:port)，服务器发推送时会代其向该地址发请求。可用逗号分隔的
// PUSH_ENDPOINT_EXTRA_HOSTS 追加后缀，以防未来新服务或自建推送网关被误拦。
const PUSH_HOST_SUFFIXES = [
  'googleapis.com', 'push.services.mozilla.com',
  'notify.windows.com', 'wns.windows.com', 'push.apple.com',
  ...String(process.env.PUSH_ENDPOINT_EXTRA_HOSTS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
];
function isAllowedPushEndpoint(endpoint) {
  let u;
  try { u = new URL(String(endpoint)); } catch { return false; }
  if (u.protocol !== 'https:') return false; // 必须 https，挡 http/file/gopher 等
  const host = u.hostname.toLowerCase();
  // host===后缀 或 .后缀 结尾；前导点防 evilgoogleapis.com 这类绕过
  return PUSH_HOST_SUFFIXES.some(s => host === s || host.endsWith('.' + s));
}

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.email, config.vapid.publicKey, config.vapid.privateKey);
}

// ── Firebase Admin（可选）────────────────────────────────────────
let firebaseAdmin = null;
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId:   process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }
    firebaseAdmin = admin;
    console.debug('[Push] Firebase Admin 初始化成功');
  } catch (e) {
    console.warn('[Push] Firebase Admin 初始化失败:', e.message);
  }
} else {
  console.debug('[Push] Firebase 未配置，FCM/APNs 推送不可用');
}

// 单个收件人的推送语言。pushNewMessage 走批量查询一次取回所有人的 lang；
// 而好友申请/朋友圈互动/来电这些是「推给某一个人」的路径，用这个按需取。
// 取不到（用户不存在/未建 settings 行）一律回落 zh-CN，与改动前行为一致。
function langOf(userId) {
  try {
    const row = db.prepare('SELECT lang FROM user_settings WHERE user_id=?').get(userId);
    return pushI18n.normalizeLang(row?.lang);
  } catch {
    return pushI18n.DEFAULT_LANG;
  }
}

async function pushToUser(userId, payload) {
  // 调用方没显式给 lang 时按收件人解析一次，保证下面个推的兜底文案也是对的语言
  if (!payload.lang) payload = { ...payload, lang: langOf(userId) };
  const promises = [];

  const webSubs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').all(userId);
  // 一次查出该用户全部 device_tokens，按 platform 在内存里分组——此前这里分 4 次
  // （android/ios_apns/ios/getui）各查一遍同一张表，pushNewMessage 对群内每个非发送者
  // 成员都调一次 pushToUser，500 人群一条消息就是 2000 次同步 better-sqlite3 查询堵
  // 事件循环。三行外的 push_subscriptions 早就是单次查询，唯独 device_tokens 这 4 次
  // 一直没跟上，属同一处遗漏。
  const deviceTokens = db.prepare('SELECT * FROM device_tokens WHERE user_id=?').all(userId);
  const tokensOf = (platform) => deviceTokens.filter(r => r.platform === platform);
  for (const row of webSubs) {
    try {
      const sub = JSON.parse(row.subscription);
      // 纵深防御：跳过非法/内网 endpoint（挡入口校验前遗留的存量恶意订阅），防 SSRF
      if (!isAllowedPushEndpoint(sub?.endpoint)) continue;
      promises.push(
        webpush.sendNotification(sub, JSON.stringify(payload)).catch(err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(row.id);
          }
        })
      );
    } catch {}
  }

  if (firebaseAdmin) {
    // 只取真正的 FCM token（android/ios）。个推 CID（platform='getui'）不是合法 FCM token，
    // 若混进来会被 FCM 判为无效 → 命中下方失效清理逻辑而被误删，
    // 国产 ROM 上（FCM token 恒为 null，仅有个推 CID）会因此丢掉唯一的锁屏通路。个推交给下面的个推循环。

    // ────────── 优化：使用批量发送而不是逐条发送 ──────────
    // 优化前：对每个 token 逐条调用 firebaseAdmin.messaging().send()
    // 优化后：一次 API 调用通过 sendEachForMulticast() 批量发送
    // 性能提升：减少 70-90% 的 API 调用

    // 检查是否有 Android 设备
    const androidTokens = tokensOf('android');

    if (androidTokens.length > 0) {
      // 使用优化的批量发送
      promises.push(
        fcmOptimized.sendBatchAndroidNotifications(userId, {
          senderName: payload.senderName,
          body: payload.body,
          conversationId: payload.conversationId,
          senderId: payload.senderId,
          type: payload.type,
          timestamp: payload.timestamp,
          badge: payload.badge,
        }).catch(err => {
          console.warn(`[push] Android 批量推送异常: ${err?.message}`);
        })
      );
    }

    // iOS 单独处理：优先直连 APNs(platform='ios_apns', 原始 64 位 hex token)，
    // 兼容旧版只上报 FCM token 的设备(platform='ios', 走 FCM 兜底)。
    const iosApnsTokens = tokensOf('ios_apns');
    const iosTokens = tokensOf('ios');

    for (const row of iosApnsTokens) {
      // APNs 直连(HTTP/2 + Provider Token)：不依赖 Firebase 控制台 APNs 密钥配置。
      // 未配置 APNS_* 时返回 skipped；直连失败降级 FCM(如有 FCM token)。
      promises.push(
        sendIosPush(row.token, {
          title: payload.senderName,
          body: payload.body,
          badge: payload.badge || 1,
          conversationId: payload.conversationId,
          senderId: payload.senderId,
          timestamp: payload.timestamp,
          type: payload.type,
        }).then((res) => {
          if (res?.ok || res?.skipped || !firebaseAdmin || !iosTokens.length) return;
          // 直连失败且有 FCM token → 降级 FCM(双保险)
          const msg = {
            token: iosTokens[0].token,
            notification: { title: payload.senderName, body: payload.body },
            data: {
              conversationId: payload.conversationId || '',
              senderId:       payload.senderId || '',
              timestamp:      String(payload.timestamp || Date.now()),
              type:           payload.type || 'message',
            },
            apns: {
              headers: { 'apns-push-type': 'alert', 'apns-priority': '10' },
              payload: {
                aps: {
                  alert: { title: payload.senderName, body: payload.body },
                  sound: 'default',
                  badge: payload.badge || 1,
                },
              },
            },
          };
          return firebaseAdmin.messaging().send(msg)
            .then(id => { console.debug(`[push] iOS FCM 兜底发送成功 user=${userId} msgId=${id}`); })
            .catch(err => {
              if (err.code === 'messaging/invalid-registration-token' ||
                  err.code === 'messaging/registration-token-not-registered') {
                db.prepare('DELETE FROM device_tokens WHERE id=?').run(iosTokens[0].id);
              }
              console.warn(`[push] iOS FCM 兜底失败 user=${userId} code=${err.code}`);
            });
        }).catch(err => {
          console.warn(`[push] iOS 直连异常 user=${userId}: ${err?.message}`);
        })
      );
    }

    // 已存在 APNs 原生 token 的用户不再并行走 iOS FCM，避免同一设备重复通知。
    const iosFcmTokens = iosApnsTokens.length ? [] : iosTokens;
    for (const row of iosFcmTokens) {
      // 旧版设备仅上报 FCM token：走 FCM→APNs(需 Firebase 控制台已上传 APNs 密钥；
      // 未上传时 FCM 报 third-party-auth-error,此处仅记录)。
      if (!firebaseAdmin) continue;
      const message = {
        token: row.token,
        notification: { title: payload.senderName, body: payload.body },
        data: {
          conversationId: payload.conversationId || '',
          senderId:       payload.senderId || '',
          timestamp:      String(payload.timestamp || Date.now()),
          type:           payload.type || 'message',
        },
        apns: {
          headers: {
            // 锁屏/后台送达的关键：alert 类型 + 最高优先级（10=立即送达并唤醒屏幕）
            'apns-push-type': 'alert',
            'apns-priority': '10',
          },
          payload: {
            aps: {
              alert: { title: payload.senderName, body: payload.body },
              sound: 'default',
              badge: payload.badge || 1,
            },
          },
        },
      };
      promises.push(
        firebaseAdmin.messaging().send(message)
          .then(id => { console.debug(`[push] iOS FCM 发送成功 user=${userId} msgId=${id}`); })
          .catch(err => {
            console.warn(`[push] iOS FCM 发送失败 user=${userId} code=${err.code || '?'} msg=${err.message}`);
            if (err.code === 'messaging/invalid-registration-token' ||
                err.code === 'messaging/registration-token-not-registered') {
              db.prepare('DELETE FROM device_tokens WHERE id=?').run(row.id);
            }
          })
      );
    }
  }

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === 'rejected') console.warn('[push] 推送失败:', r.reason?.message || r.reason);
  }

  // ── 个推（国产 ROM 覆盖，与 FCM 并行互不干扰）──────────────
  if (getuiPush.isEnabled()) {
    const getuiTokens = tokensOf('getui');
    for (const row of getuiTokens) {
      getuiPush.pushToCid(row.token, {
        title: payload.senderName || pushI18n.t(payload.lang, 'push.newMessage'),
        body: payload.body || pushI18n.t(payload.lang, 'push.oneNewMessage'),
        payload: { type: payload.type || 'message', conversationId: payload.conversationId || '', senderId: payload.senderId || '' },
      }).then(({ json }) => {
        if (json.code !== 0) {
          console.warn(`[push] 个推失败 user=${userId} code=${json.code} msg=${json.msg}`);
          // CID 失效时清除，避免无效推送积累
          if (json.code === 10001 || json.code === 10002) {
            db.prepare('DELETE FROM device_tokens WHERE id=?').run(row.id);
          }
        } else {
          console.debug(`[push] 个推成功 user=${userId}`);
        }
      }).catch(e => console.warn(`[push] 个推异常: ${e.message}`));
    }
  }
}

// 勿扰时段判定：quietStart/quietEnd 为 "HH:MM"（服务器本地时区）。
// 支持跨零点区间（如 23:00~07:00）：start<=end 为当日区间，start>end 为跨夜区间。
// 时间格式非法时返回 false（不抑制推送，安全降级）。
function isInQuietHours(quietStart, quietEnd, now = new Date()) {
  const parse = (s) => {
    if (typeof s !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const start = parse(quietStart);
  const end = parse(quietEnd);
  if (start == null || end == null || start === end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return start < end
    ? (cur >= start && cur < end)          // 当日区间，如 09:00~12:00
    : (cur >= start || cur < end);          // 跨夜区间，如 23:00~07:00
}

// 正文按【收件人】语言生成——同一条消息推给不同语言的成员，文案各不相同，
// 所以不能像以前那样在循环外算一次全局 body。见 utils/pushI18n.js。
function buildBody(type, content, lang) {
  return pushI18n.bodyForMessage(lang, type, content);
}

async function pushNewMessage({ conversationId, senderId, senderName, content, type, timestamp, onlineUserIds, members: cachedMembers }) {
  const members = cachedMembers ||
    db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').all(conversationId);

  // 「幽灵在线」修复：不再因 socket 在线就跳过推送。
  // 锁屏/后台但进程存活、socket 仍连着时，服务端会误判用户在线 → 不发 FCM/APNs
  // → 锁屏无任何通知（微信/WhatsApp 不存在此问题：它们总是推送）。
  // 现改为：给所有非发送者成员都推送；由客户端决定是否展示——
  //   · App 在前台且在当前会话 → 客户端静默丢弃（避免打扰）
  //   · App 在后台/锁屏/被杀 → 系统或客户端本地通知栏展示
  // onlineUserIds 保留仅用于日志/未来精细化，不再用于过滤。
  const targetUids = members
    .map(m => m.user_id)
    .filter(uid => uid !== senderId);
  if (!targetUids.length) return;

  const ph = targetUids.map(() => '?').join(',');
  const settingsRows = db.prepare(`
    SELECT u.id AS user_id,
      COALESCE(cs.last_read_at, 0) AS last_read_at,
      COALESCE(cs.muted, 0) AS muted,
      COALESCE(us.message_notify, 1) AS message_notify,
      COALESCE(us.detail_preview, 1) AS detail_preview,
      COALESCE(us.sound, 1) AS sound,
      COALESCE(us.vibrate, 0) AS vibrate,
      COALESCE(us.quiet_enabled, 0) AS quiet_enabled,
      COALESCE(us.quiet_start, '23:00') AS quiet_start,
      COALESCE(us.quiet_end, '07:00') AS quiet_end,
      COALESCE(us.lang, 'zh-CN') AS lang
    FROM users u
    LEFT JOIN user_settings us ON us.user_id = u.id
    LEFT JOIN conversation_settings cs ON cs.user_id = u.id AND cs.conversation_id = ?
    WHERE u.id IN (${ph})
  `).all(conversationId, ...targetUids);
  const settingsMap = new Map(settingsRows.map(r => [r.user_id, r]));
  const defaultSettings = { last_read_at: 0, muted: 0, message_notify: 1, detail_preview: 1, sound: 1, vibrate: 0, quiet_enabled: 0, quiet_start: '23:00', quiet_end: '07:00', lang: pushI18n.DEFAULT_LANG };

  // 批量未读数（优化 N+1）：一次查询取回所有目标用户的未读数，替代循环内逐用户 COUNT。
  // 大群（500 人）一条消息原为 500 次同步 SQLite 查询阻塞事件循环，现为 1 次。
  // 语义对齐原实现：排除发送者本人、按各自 last_read_at（conversation_settings）过滤。
  const unreadRows = db.prepare(`
    SELECT cm.user_id AS uid,
      (SELECT COUNT(*) FROM messages m
       WHERE m.conversation_id = cm.conversation_id
         AND m.deleted = 0
         AND m.sender_id != ?
         AND m.created_at > COALESCE(
           (SELECT cs.last_read_at FROM conversation_settings cs
            WHERE cs.user_id = cm.user_id AND cs.conversation_id = cm.conversation_id), 0)
      ) AS cnt
    FROM conversation_members cm
    WHERE cm.conversation_id = ? AND cm.user_id IN (${ph})
  `).all(senderId, conversationId, ...targetUids);
  const unreadMap = new Map(unreadRows.map(r => [r.uid, Math.min(Number(r.cnt) || 0, 99)]));

  const pushPromises = targetUids.map(uid => {
    const settings = settingsMap.get(uid) || defaultSettings;
    if (!Number(settings.message_notify)) return null;   // 全局关闭新消息通知
    if (Number(settings.muted)) return null;             // 该会话已设免打扰 → 不推送
    // 勿扰时段检查：开启且当前时刻落在时段内 → 抑制推送（消息本身照常入库送达）
    if (Number(settings.quiet_enabled) && isInQuietHours(settings.quiet_start, settings.quiet_end)) return null;
    const unread = unreadMap.get(uid) || 1;
    const lang = pushI18n.normalizeLang(settings.lang);
    return pushToUser(uid, {
      title:   senderName,
      body:    Number(settings.detail_preview)
        ? buildBody(type, content, lang)
        : pushI18n.t(lang, 'push.oneNewMessage'),
      lang,
      senderName, senderId, conversationId, type, timestamp,
      badge:   unread,
      sound:   !!Number(settings.sound),
      vibrate: !!Number(settings.vibrate),
    });
  }).filter(Boolean);

  await Promise.allSettled(pushPromises);
}


// ── APNs 直连（iOS 普通消息推送,不依赖 Firebase 控制台 APNs 密钥）────
// Firebase 控制台需要浏览器登录上传 APNs 密钥才能让 FCM→APNs 转发,无人值守环境
// 做不到;且密钥未配置时 FCM 返回 third-party-auth-error,iOS 完全收不到。
// 方案:与 VoIP 同款直连 api.push.apple.com(HTTP/2 + ES256 Provider Token),
// 密钥已验证对 com.touliao.app 有效(400 BadDeviceToken=认证通过)。
const APNS_TOPIC = 'com.touliao.app';
const APNS_HOST = 'https://api.push.apple.com:443';   // 生产环境(TestFlight/App Store)
// const APNS_HOST = 'https://api.sandbox.push.apple.com:443'; // 开发环境(debug 真机)

function sendIosPush(deviceToken, { title, body, badge, conversationId, senderId, timestamp, type, collapseId }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const authToken = getApnsVoipToken();   // 同一把 p8 密钥,复用 JWT 缓存
    if (!authToken) {
      console.warn('[push] APNs 未配置（缺 APNS_P8/APNS_KEY_ID/APNS_TEAM_ID）,跳过 iOS 直连');
      finish({ ok: false, skipped: true });
      return;
    }
    const payload = {
      aps: {
        alert: { title: String(title || ''), body: String(body || '') },
        sound: 'default',
        badge: Number(badge) || 1,
        'mutable-content': 1,
      },
      conversationId: String(conversationId || ''),
      senderId: String(senderId || ''),
      timestamp: String(timestamp || Date.now()),
      type: type || 'message',
    };
    let client;
    try {
      client = http2.connect(APNS_HOST);
    } catch (e) {
      console.warn('[push] APNs 直连连接失败:', e.message);
      finish({ ok: false });
      return;
    }
    client.on('error', (e) => {
      console.warn('[push] APNs http2 连接异常:', e.message);
      client.destroy();
      finish({ ok: false });
    });
    client.setTimeout(10000, () => {
      console.warn('[push] APNs http2 连接超时');
      client.destroy();
      finish({ ok: false, timeout: true });
    });
    const headers = {
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-topic': APNS_TOPIC,
      authorization: `bearer ${authToken}`,
      'content-type': 'application/json',
    };
    if (collapseId) headers['apns-collapse-id'] = String(collapseId).slice(0, 64);
    const req = client.request(headers);
    req.setTimeout(10000, () => {
      console.warn('[push] APNs 请求超时');
      req.close();
      client.destroy();
      finish({ ok: false, timeout: true });
    });
    let status = 0;
    let resBody = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (chunk) => { resBody += chunk; });
    req.on('end', () => {
      client.close();
      if (status === 200) {
        console.debug(`[push] iOS APNs 直连成功 token=${String(deviceToken).slice(0,12)}…`);
        finish({ ok: true });
        return;
      }
      let reason = '';
      try { reason = JSON.parse(resBody || '{}').reason || ''; } catch {}
      if (status === 401 || status === 403) {
        console.warn(`[push] iOS APNs 凭据无效 status=${status} body=${resBody}`);
      } else if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
        // 设备 token 已失效(卸载/重装/系统回收)→ 清理,避免反复无效推送
        try { db.prepare('DELETE FROM device_tokens WHERE token=?').run(deviceToken); } catch {}
        console.warn(`[push] iOS token 失效已清理 status=${status} reason=${reason}`);
      } else {
        console.warn(`[push] iOS APNs 推送失败 status=${status} reason=${reason}`);
      }
      finish({ ok: false, status });
    });
    req.on('error', (e) => {
      console.warn('[push] iOS APNs 请求异常:', e.message);
      req.close();
      client.destroy();
      finish({ ok: false });
    });
    req.end(JSON.stringify(payload));
  });
}

// ── APNs VoIP push（PushKit，走 firebase-admin 之外的独立通路）──────
// firebase-admin/FCM 不代发 APNs VoIP（voip 类型 token 不是 FCM token），需直连
// api.push.apple.com 用 HTTP/2 + APNs Provider Token（ES256 JWT）发送。
const APNS_VOIP_TOPIC = 'com.touliao.app.voip';
let apnsVoipJwtCache = null; // { token, iat } —— 同一 JWT 复用一段时间，避免每次推送都重新签名

function getApnsVoipToken() {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const p8 = process.env.APNS_P8;
  if (!keyId || !teamId || !p8) return null;
  const now = Math.floor(Date.now() / 1000);
  // APNs 建议单个 Provider Token 有效期不超过 1 小时，55 分钟内复用留安全余量
  if (apnsVoipJwtCache && now - apnsVoipJwtCache.iat < 55 * 60) return apnsVoipJwtCache.token;
  const privateKey = p8.replace(/\\n/g, '\n');
  const token = jwt.sign({ iss: teamId, iat: now }, privateKey, {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: keyId },
  });
  apnsVoipJwtCache = { token, iat: now };
  return token;
}

// PushKit voip push：纯自定义 JSON payload（不允许带 aps.alert），app 收到后自行
// reportNewIncomingCall 弹 CallKit 界面。凭据缺失时静默降级（不影响其他推送通路）。
function sendVoipPush(deviceToken, { callId, from, callerName, callType }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const authToken = getApnsVoipToken();
    if (!authToken) {
      console.warn('[call-push] APNs voip 未配置（缺 APNS_P8/APNS_KEY_ID/APNS_TEAM_ID）');
      finish({ ok: false, skipped: true });
      return;
    }
    const body = JSON.stringify({
      type: 'call',
      callId: String(callId || ''),
      from: String(from || ''),
      callerName: String(callerName || ''),
      callType: callType === 'video' ? 'video' : 'audio',
      ts: Date.now(),
    });

    let client;
    try {
      client = http2.connect('https://api.push.apple.com:443');
    } catch (e) {
      console.warn('[call-push] APNs voip 连接失败:', e.message);
      finish({ ok: false });
      return;
    }
    client.on('error', (e) => {
      console.warn('[call-push] APNs voip http2 连接异常:', e.message);
      client.destroy();
      finish({ ok: false });
    });
    client.setTimeout(10000, () => {
      console.warn('[call-push] APNs voip http2 连接超时');
      client.destroy();
      finish({ ok: false, timeout: true });
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'apns-push-type': 'voip',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 60),
      'apns-topic': APNS_VOIP_TOPIC,
      authorization: `Bearer ${authToken}`,
      'content-type': 'application/json',
    });
    req.setTimeout(10000, () => {
      console.warn('[call-push] APNs voip 请求超时');
      req.close();
      client.destroy();
      finish({ ok: false, timeout: true });
    });

    let status = 0;
    let resBody = '';
    req.on('response', (headers) => { status = headers[':status']; });
    req.setEncoding('utf8');
    req.on('data', (chunk) => { resBody += chunk; });
    req.on('end', () => {
      client.close();
      if (status === 200) {
        finish({ ok: true });
        return;
      }
      let reason = '';
      try { reason = JSON.parse(resBody || '{}').reason || ''; } catch {}
      if (status === 401 || status === 403) {
        // 凭据问题（JWT 失效/kid 或 team 不匹配），不是设备的问题，不清 token
        console.warn(`[call-push] APNs voip 凭据无效 status=${status} body=${resBody}`);
      } else if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
        // 设备 token 已失效（卸载/重装/系统回收）→ 清理，避免反复无效推送
        try { db.prepare('DELETE FROM device_tokens WHERE token=?').run(deviceToken); } catch {}
        console.warn(`[call-push] APNs voip token 失效已清理 status=${status} reason=${reason}`);
      } else {
        console.warn(`[call-push] APNs voip 推送失败 status=${status} reason=${reason}`);
      }
      finish({ ok: false, status });
    });
    req.on('error', (e) => {
      console.warn('[call-push] APNs voip 请求异常:', e.message);
      req.close();
      client.destroy();
      finish({ ok: false });
    });
    req.end(body);
  });
}

// iOS 来电专属 APNs 直连推送。复用 sendIosPush() 同款 HTTP/2 直连（同一把 p8 密钥/
// getApnsVoipToken()），不走 firebase-admin：pushCallInvite() 里给 'ios' 平台走的
// firebaseAdmin.messaging().send() 分支和普通消息推送一样会撞上 FCM→APNs 转发的
// third-party-auth-error（AppDelegate.swift:42-44 注释已确认的根因），来电推送因此
// 从未真正送达过。'ios_apns' 平台的 token 直连不经过 FCM，绕开这条失败路径。
// payload 顶层 from/callerName/callId/callType 字段名与 AppDelegate.swift:89-92
// 读取 userInfo 的字段名一一对应（ANSWER/DECLINE 通知动作靠这几个字段重建来电状态）。
function sendIosCallPush(deviceToken, { callId, from, toUserId, callerName, callType, lang }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const authToken = getApnsVoipToken();   // 同一把 p8 密钥,复用 JWT 缓存
    if (!authToken) {
      console.warn('[call-push] APNs 未配置（缺 APNS_P8/APNS_KEY_ID/APNS_TEAM_ID）,跳过 iOS 来电直连');
      finish({ ok: false, skipped: true });
      return;
    }
    const isVideo = callType === 'video';
    const payload = {
      aps: {
        alert: { title: callerName || pushI18n.t(lang, 'call.title'), body: pushI18n.t(lang, isVideo ? 'call.video' : 'call.audio') },
        sound: 'default',
        category: 'INCOMING_CALL',
      },
      from: String(from || ''),
      callerName: String(callerName || ''),
      callId: String(callId || ''),
      callType: isVideo ? 'video' : 'audio',
    };
    let client;
    try {
      client = http2.connect(APNS_HOST);
    } catch (e) {
      console.warn('[call-push] APNs 来电直连连接失败:', e.message);
      finish({ ok: false });
      return;
    }
    client.on('error', (e) => {
      console.warn('[call-push] APNs 来电 http2 连接异常:', e.message);
      client.destroy();
      finish({ ok: false });
    });
    client.setTimeout(10000, () => {
      console.warn('[call-push] APNs 来电 http2 连接超时');
      client.destroy();
      finish({ ok: false, timeout: true });
    });
    const headers = {
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-topic': APNS_TOPIC,
      authorization: `bearer ${authToken}`,
      'content-type': 'application/json',
      // 同一对通话方复呼时收敛为一条系统通知，避免旧来电通知堆积可操作
      'apns-collapse-id': `call_${from}_${toUserId}`.slice(0, 64),
      // 立即过期：离线期间堆积的旧来电不应在设备恢复在线后被 APNs 补投
      'apns-expiration': '0',
    };
    const req = client.request(headers);
    req.setTimeout(10000, () => {
      console.warn('[call-push] APNs 来电请求超时');
      req.close();
      client.destroy();
      finish({ ok: false, timeout: true });
    });
    let status = 0;
    let resBody = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (chunk) => { resBody += chunk; });
    req.on('end', () => {
      client.close();
      if (status === 200) {
        console.debug(`[call-push] iOS 来电 APNs 直连成功 token=${String(deviceToken).slice(0,12)}…`);
        finish({ ok: true });
        return;
      }
      let reason = '';
      try { reason = JSON.parse(resBody || '{}').reason || ''; } catch {}
      if (status === 401 || status === 403) {
        console.warn(`[call-push] iOS 来电 APNs 凭据无效 status=${status} body=${resBody}`);
      } else if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
        // 设备 token 已失效(卸载/重装/系统回收)→ 清理,避免反复无效推送
        try { db.prepare('DELETE FROM device_tokens WHERE token=?').run(deviceToken); } catch {}
        console.warn(`[call-push] iOS 来电 token 失效已清理 status=${status} reason=${reason}`);
      } else {
        console.warn(`[call-push] iOS 来电 APNs 推送失败 status=${status} reason=${reason}`);
      }
      finish({ ok: false, status });
    });
    req.on('error', (e) => {
      console.warn('[call-push] iOS 来电 APNs 请求异常:', e.message);
      req.close();
      client.destroy();
      finish({ ok: false });
    });
    req.end(JSON.stringify(payload));
  });
}

// ── 来电推送 ────────────────────────────────────────────────────
// 被叫离线时用。Android：发 data-only 高优先级 FCM，不带 notification 块，
// 以保证 Android 端 onMessageReceived 一定被触发（去构建 fullScreenIntent 来电界面）；
// 带 notification 块的推送在 App 后台会被系统托盘直接消费、拿不到 data。
// iOS：'ios_apns' 平台走上面 sendIosCallPush() 直连 APNs（绕开 FCM→APNs 转发失败问题，
// 2026-08-30 修复，此前只有 'ios'/'ios_voip' 两种平台会被处理，'ios_apns' 的设备
// token 完全没有被这条查询覆盖到，来电推送从未真正送达过，详见 AUDIT.md）。
// 'ios' 平台仍走原 firebaseAdmin FCM 分支保留兼容（历史遗留，真实设备现在只会注册
// 'ios_apns'，这个分支理论上不会再命中，但不在这次改动范围内清理）。
async function pushCallInvite({ toUserId, fromUserId, callerName, callType, callId }) {
  // 注意：ios_voip / ios_apns 都走独立 APNs 直连通路（不依赖 firebaseAdmin）；
  // 因此这里不能用 if (!firebaseAdmin) return 整体短路，否则这两条直连通路被误拦。
  // getui（国产 ROM 无 GMS 兜底）：走独立个推透传+厂商通道，同样不依赖 firebaseAdmin。
  const deviceTokens = db.prepare(
    "SELECT * FROM device_tokens WHERE user_id=? AND platform IN ('android','ios','ios_apns','ios_voip','getui')"
  ).all(toUserId);
  if (!deviceTokens.length) return;
  const isVideo = callType === 'video';
  // 来电通知文案按【被叫方】语言渲染（此前 '来电'/'邀请你视频通话' 是写死的简中）
  const lang = langOf(toUserId);
  const promises = [];
  // FCM 优先（防同设备双弹）：有 android(FCM) token 的 GMS 设备，全屏来电走 FCM——
  // 被杀场景 FCM 仍能拉起进程弹 fullScreenIntent，能力最完整；个推仅兜底无 GMS 的设备。
  // 同一台设备同时注册 android+getui 双 token（PushManager 逻辑），若两者都推会双弹来电。
  const hasAndroidFcm = deviceTokens.some(r => r.platform === 'android');
  for (const row of deviceTokens) {
    if (row.platform === 'getui') {
      if (hasAndroidFcm) continue;   // FCM 已覆盖，个推不重复推（防双弹）
      promises.push(getuiPush.pushCallToCid(row.token, {
        callId, from: fromUserId, callerName, callType: isVideo ? 'video' : 'audio', lang,
      }).catch(err => console.warn(`[push] 个推来电失败 user=${toUserId}: ${err.message}`)));
      continue;
    }
    if (row.platform === 'ios_voip') {
      promises.push(sendVoipPush(row.token, { callId, from: fromUserId, callerName, callType: isVideo ? 'video' : 'audio' }));
      continue;
    }
    if (row.platform === 'ios_apns') {
      promises.push(sendIosCallPush(row.token, { callId, from: fromUserId, toUserId, callerName, callType: isVideo ? 'video' : 'audio', lang }));
      continue;
    }
    const message = {
      token: row.token,
      data: {
        type:       'call',
        callType:   isVideo ? 'video' : 'audio',
        from:       String(fromUserId || ''),
        callerName: String(callerName || ''),
        callId:     String(callId || ''),
      },
      android: { priority: 'high' },
    };
    if (row.platform === 'ios') {
      message.apns = {
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': '10',
          // 同一对通话方复呼时收敛为一条系统通知，避免旧来电通知堆积可操作
          'apns-collapse-id': `call_${fromUserId}_${toUserId}`.slice(0, 64),
          // 立即过期：离线期间堆积的旧来电不应在设备恢复在线后被 APNs 补投
          'apns-expiration': '0',
        },
        payload: {
          aps: {
            alert: { title: callerName || pushI18n.t(lang, 'call.title'), body: pushI18n.t(lang, isVideo ? 'call.video' : 'call.audio') },
            sound: 'default',
            category: 'INCOMING_CALL',
          },
        },
      };
    }
    if (!firebaseAdmin) continue;   // FCM 未配置时跳过 android/ios（ios_voip 已在上方走独立 APNs 直连）
    promises.push(firebaseAdmin.messaging().send(message).catch(err => {
      if (err.code === 'messaging/invalid-registration-token' ||
          err.code === 'messaging/registration-token-not-registered') {
        db.prepare('DELETE FROM device_tokens WHERE id=?').run(row.id);
      }
    }));
  }
  await Promise.allSettled(promises);
}

module.exports = { pushToUser, pushNewMessage, pushCallInvite, sendIosPush, isAllowedPushEndpoint, isInQuietHours, langOf };
