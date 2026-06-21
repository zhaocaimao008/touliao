#!/usr/bin/env node
'use strict';
/**
 * 后端推送自测脚本：用 firebase-admin 直接发一条 FCM 测试推送。
 *
 * 用法:
 *   node scripts/test-push.js --token <FCM_TOKEN>          # 直接发到某设备 token
 *   node scripts/test-push.js --user  <USER_ID>           # 发到该用户在 device_tokens 里的全部 token
 *   可选: --title "标题" --body "内容"
 *
 * 依赖 .env 中的 FIREBASE_*（先跑 setup-firebase-admin.js）。
 */
require('dotenv').config();
const path = require('path');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const token = arg('token');
const userId = arg('user');
const title = arg('title') || 'v信 测试推送';
const body = arg('body') || '这是一条来自后端的测试推送 🎉';

if (!token && !userId) {
  console.error('用法: node scripts/test-push.js --token <FCM_TOKEN> | --user <USER_ID> [--title x --body y]');
  process.exit(1);
}

if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('❌ 未配置 FIREBASE_*，先跑 node scripts/setup-firebase-admin.js <service-account.json>');
  process.exit(1);
}

const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

function resolveTokens() {
  if (token) return [token];
  // 从 SQLite 的 device_tokens 表查该用户的 token
  const Database = require('better-sqlite3');
  const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../wechat.db');
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT token FROM device_tokens WHERE user_id=?').all(userId);
  db.close();
  return rows.map(r => r.token);
}

(async () => {
  const tokens = resolveTokens();
  if (tokens.length === 0) {
    console.error('❌ 没有可用的设备 token（用户未注册推送 token？）');
    process.exit(1);
  }
  console.log(`发送到 ${tokens.length} 个设备…`);
  let ok = 0, fail = 0;
  for (const t of tokens) {
    try {
      const id = await admin.messaging().send({
        token: t,
        notification: { title, body },
        data: { type: 'test', timestamp: String(Date.now()) },
        android: { priority: 'high', notification: { channelId: 'vxin_messages', sound: 'default' } },
        apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      });
      console.log('  ✅', id);
      ok++;
    } catch (e) {
      console.log('  ❌', e.errorInfo?.code || e.message);
      fail++;
    }
  }
  console.log(`完成: 成功 ${ok}, 失败 ${fail}`);
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
})();
