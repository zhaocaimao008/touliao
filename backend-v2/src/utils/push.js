'use strict';
/**
 * 推送服务：Web Push (VAPID) + FCM/APNs (firebase-admin)。
 * pushNewMessage 只向「会话内、非发送者、当前离线」的成员推送，
 * 并按各自的免打扰/详情预览/声音/震动设置定制 payload。
 */
const webpush = require('web-push');
const config = require('../config');
const { db } = require('../db/connection');

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
        android: { priority: 'high', notification: { channelId: 'vxin_messages', sound: 'default' } },
        apns:    { payload: { aps: { sound: 'default', badge: payload.badge || 1 } } },
      };
      promises.push(
        firebaseAdmin.messaging().send(message).catch(err => {
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
}

function buildBody(type, content) {
  switch (type) {
    case 'image':        return '[图片]';
    case 'voice':        return '[语音]';
    case 'file':         return `[文件] ${content}`;
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

  const settingsStmt = db.prepare(
    `SELECT cs.last_read_at,
            COALESCE(us.message_notify, 1) AS message_notify,
            COALESCE(us.detail_preview, 1) AS detail_preview,
            COALESCE(us.sound, 1) AS sound,
            COALESCE(us.vibrate, 0) AS vibrate
     FROM user_settings us
     LEFT JOIN conversation_settings cs
       ON cs.user_id = us.user_id AND cs.conversation_id = ?
     WHERE us.user_id = ?
     UNION ALL
     SELECT cs.last_read_at, 1, 1, 1, 0
     FROM conversation_settings cs
     WHERE cs.user_id = ? AND cs.conversation_id = ?
       AND NOT EXISTS (SELECT 1 FROM user_settings WHERE user_id = ?)
     LIMIT 1`
  );
  const unreadStmt = db.prepare(
    'SELECT COUNT(*) as cnt FROM (SELECT 1 FROM messages WHERE conversation_id=? AND sender_id!=? AND deleted=0 AND created_at>? LIMIT 99)'
  );

  const pushPromises = members
    .map(m => m.user_id)
    .filter(uid => uid !== senderId && !onlineUserIds.has(uid))
    .map(uid => {
      const settings = settingsStmt.get(conversationId, uid, uid, conversationId, uid) ||
        { last_read_at: 0, message_notify: 1, detail_preview: 1, sound: 1, vibrate: 0 };

      if (!Number(settings.message_notify)) return null;

      const unread = unreadStmt.get(conversationId, uid, settings?.last_read_at || 0)?.cnt || 1;

      return pushToUser(uid, {
        title:   senderName,
        body:    Number(settings.detail_preview) ? body : '收到一条新消息',
        senderName, senderId, conversationId, type, timestamp,
        badge:   unread,
        sound:   !!Number(settings.sound),
        vibrate: !!Number(settings.vibrate),
      });
    })
    .filter(Boolean);

  await Promise.allSettled(pushPromises);
}

module.exports = { pushToUser, pushNewMessage };
