'use strict';
/**
 * 推送服务：Web Push (VAPID) + FCM/APNs (firebase-admin) + 个推 GeTui（国产 ROM）。
 * pushNewMessage 向会话内、非发送者的所有成员推送，
 * 并按各自的免打扰/详情预览/声音/震动设置定制 payload。
 * 推送优先级：FCM（GMS 设备）+ 个推（国产 ROM）并行，互不干扰。
 */
const webpush = require('web-push');
const config = require('../config');
const { db } = require('../db/connection');
const getuiPush = require('./getuiPush');

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
    console.log('[Push] Firebase Admin 初始化成功');
  } catch (e) {
    console.warn('[Push] Firebase Admin 初始化失败:', e.message);
  }
} else {
  console.log('[Push] Firebase 未配置，FCM/APNs 推送不可用');
}

async function pushToUser(userId, payload) {
  const promises = [];

  const webSubs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').all(userId);
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
    const deviceTokens = db.prepare('SELECT * FROM device_tokens WHERE user_id=?').all(userId);
    for (const row of deviceTokens) {
      const message = {
        token: row.token,
        notification: { title: payload.senderName, body: payload.body },
        data: {
          conversationId: payload.conversationId || '',
          senderId:       payload.senderId || '',
          timestamp:      String(payload.timestamp || Date.now()),
          type:           payload.type || 'message',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'vxin_messages_v3',
            sound: 'default',
            // 锁屏/后台高优先级弹出 + 默认震动（渠道已开震动，这里再兜底）
            defaultVibrateTimings: true,
            notificationPriority: 'PRIORITY_HIGH',
          },
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
          .then(id => { console.log(`[push] FCM 发送成功 user=${userId} msgId=${id}`); })
          .catch(err => {
            // 打印完整错误码，便于排查锁屏收不到通知（如 project 不匹配/token 失效/凭证错误）
            console.warn(`[push] FCM 发送失败 user=${userId} code=${err.code || '?'} msg=${err.message}`);
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
    const getuiTokens = db.prepare("SELECT * FROM device_tokens WHERE user_id=? AND platform='getui'").all(userId);
    for (const row of getuiTokens) {
      getuiPush.pushToCid(row.token, {
        title: payload.senderName || '新消息',
        body: payload.body || '收到一条新消息',
        payload: { conversationId: payload.conversationId || '', senderId: payload.senderId || '' },
      }).then(({ json }) => {
        if (json.code !== 0) {
          console.warn(`[push] 个推失败 user=${userId} code=${json.code} msg=${json.msg}`);
          // CID 失效时清除，避免无效推送积累
          if (json.code === 10001 || json.code === 10002) {
            db.prepare('DELETE FROM device_tokens WHERE id=?').run(row.id);
          }
        } else {
          console.log(`[push] 个推成功 user=${userId}`);
        }
      }).catch(e => console.warn(`[push] 个推异常: ${e.message}`));
    }
  }
}

function buildBody(type, content) {
  switch (type) {
    case 'image':        return '[图片]';
    case 'voice':        return '[语音]';
    case 'file':         return `[文件] ${(content || '').slice(0, 50)}`;
    case 'location':     return '[位置]';
    case 'red_packet':   return '[红包] 恭喜发财';
    case 'contact_card': return '[名片]';
    default:             return content?.slice(0, 100) || '';
  }
}

async function pushNewMessage({ conversationId, senderId, senderName, content, type, timestamp, onlineUserIds, members: cachedMembers }) {
  const members = cachedMembers ||
    db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').all(conversationId);

  const body = buildBody(type, content);

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
      COALESCE(us.vibrate, 0) AS vibrate
    FROM users u
    LEFT JOIN user_settings us ON us.user_id = u.id
    LEFT JOIN conversation_settings cs ON cs.user_id = u.id AND cs.conversation_id = ?
    WHERE u.id IN (${ph})
  `).all(conversationId, ...targetUids);
  const settingsMap = new Map(settingsRows.map(r => [r.user_id, r]));
  const defaultSettings = { last_read_at: 0, muted: 0, message_notify: 1, detail_preview: 1, sound: 1, vibrate: 0 };

  const unreadStmt = db.prepare(
    'SELECT COUNT(*) as cnt FROM (SELECT 1 FROM messages WHERE conversation_id=? AND sender_id!=? AND deleted=0 AND created_at>? LIMIT 99)'
  );

  const pushPromises = targetUids.map(uid => {
    const settings = settingsMap.get(uid) || defaultSettings;
    if (!Number(settings.message_notify)) return null;   // 全局关闭新消息通知
    if (Number(settings.muted)) return null;             // 该会话已设免打扰 → 不推送
    const unread = unreadStmt.get(conversationId, uid, settings.last_read_at || 0)?.cnt || 1;
    return pushToUser(uid, {
      title:   senderName,
      body:    Number(settings.detail_preview) ? body : '收到一条新消息',
      senderName, senderId, conversationId, type, timestamp,
      badge:   unread,
      sound:   !!Number(settings.sound),
      vibrate: !!Number(settings.vibrate),
    });
  }).filter(Boolean);

  await Promise.allSettled(pushPromises);
}

// ── 来电推送（data-only）────────────────────────────────────────
// 被叫离线时用：发 data-only 高优先级 FCM，不带 notification 块，
// 以保证 Android 端 onMessageReceived 一定被触发（去构建 fullScreenIntent 来电界面）；
// 带 notification 块的推送在 App 后台会被系统托盘直接消费、拿不到 data。
// iOS 后台来电需 PushKit/CallKit(VoIP push)，此处不含 apns，避免普通 APNs 静默无效。
async function pushCallInvite({ toUserId, fromUserId, callerName, callType, callId }) {
  if (!firebaseAdmin) return;
  const deviceTokens = db.prepare('SELECT * FROM device_tokens WHERE user_id=?').all(toUserId);
  if (!deviceTokens.length) return;
  const promises = deviceTokens.map(row => {
    const message = {
      token: row.token,
      data: {
        type:       'call',
        callType:   callType === 'video' ? 'video' : 'audio',
        from:       String(fromUserId || ''),
        callerName: String(callerName || ''),
        callId:     String(callId || ''),
      },
      android: { priority: 'high' },
    };
    return firebaseAdmin.messaging().send(message).catch(err => {
      if (err.code === 'messaging/invalid-registration-token' ||
          err.code === 'messaging/registration-token-not-registered') {
        db.prepare('DELETE FROM device_tokens WHERE id=?').run(row.id);
      }
    });
  });
  await Promise.allSettled(promises);
}

module.exports = { pushToUser, pushNewMessage, pushCallInvite, isAllowedPushEndpoint };
