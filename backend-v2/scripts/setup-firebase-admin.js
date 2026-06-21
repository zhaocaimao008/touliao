#!/usr/bin/env node
'use strict';
/**
 * 把 Firebase 服务账号 JSON 自动写入 backend-v2/.env 的三个变量：
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 * 后端 utils/push.js 凭这三个变量初始化 firebase-admin 下发 FCM 推送。
 *
 * 用法:
 *   node scripts/setup-firebase-admin.js /path/to/service-account.json
 *
 * 服务账号 JSON 从 Firebase 控制台获取:
 *   项目设置 → 服务账号 → 生成新的私钥
 */
const fs = require('fs');
const path = require('path');

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('用法: node scripts/setup-firebase-admin.js <service-account.json 路径>');
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  console.error('无法读取/解析 JSON:', e.message);
  process.exit(1);
}

const projectId = sa.project_id;
const clientEmail = sa.client_email;
const privateKey = sa.private_key;
if (!projectId || !clientEmail || !privateKey) {
  console.error('JSON 缺少 project_id / client_email / private_key —— 这不是有效的服务账号文件');
  process.exit(1);
}

// 私钥转为单行(用 \n 占位)，写入 .env 双引号值；后端会还原换行
const privateKeyEscaped = privateKey.replace(/\r/g, '').replace(/\n/g, '\\n');

const envPath = path.resolve(__dirname, '..', '.env');
let lines = [];
if (fs.existsSync(envPath)) {
  lines = fs.readFileSync(envPath, 'utf8').split('\n')
    .filter(l => !/^FIREBASE_(PROJECT_ID|CLIENT_EMAIL|PRIVATE_KEY)=/.test(l.trim()));
}
// 去掉尾部空行后追加
while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
lines.push('');
lines.push('# ── Firebase Admin (FCM 推送) ── 由 setup-firebase-admin.js 自动生成');
lines.push(`FIREBASE_PROJECT_ID=${projectId}`);
lines.push(`FIREBASE_CLIENT_EMAIL=${clientEmail}`);
lines.push(`FIREBASE_PRIVATE_KEY="${privateKeyEscaped}"`);
lines.push('');

fs.writeFileSync(envPath, lines.join('\n'));
console.log('✅ 已写入', envPath);
console.log('   FIREBASE_PROJECT_ID =', projectId);
console.log('   FIREBASE_CLIENT_EMAIL =', clientEmail);
console.log('   FIREBASE_PRIVATE_KEY = (已写入，已隐藏)');
console.log('\n重启后端生效:  cd backend-v2 && npm start  (或你的进程管理器 restart)');
console.log('启动日志应出现:  [Push] Firebase Admin 初始化成功');
