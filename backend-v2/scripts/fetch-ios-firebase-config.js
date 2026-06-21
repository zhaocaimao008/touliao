#!/usr/bin/env node
'use strict';
/**
 * 用服务账号(.env 中的 FIREBASE_*)调用 Firebase 管理 API：
 *   1) 确保项目里存在 iOS 应用(bundleId=com.vxin.app)，不存在则创建
 *   2) 拉取该 iOS 应用的 GoogleService-Info.plist，写入 ios/Vxin/GoogleService-Info.plist
 * 需要服务账号具备 Firebase 管理权限(firebase.admin / editor)。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { JWT } = require('google-auth-library');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const BUNDLE_ID = 'com.vxin.app';
const OUT = path.resolve(__dirname, '../../ios/Vxin/GoogleService-Info.plist');
const API = 'https://firebase.googleapis.com/v1beta1';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    throw new Error('缺少 FIREBASE_* 环境变量，先跑 setup-firebase-admin.js');
  }
  const client = new JWT({
    email: process.env.FIREBASE_CLIENT_EMAIL,
    key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const { token } = await client.getAccessToken();
  const auth = { Authorization: `Bearer ${token}` };

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = {}; try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      const err = new Error(`${method} ${url} → ${res.status}: ${json.error?.message || text}`);
      err.status = res.status; throw err;
    }
    return json;
  }

  // 1. 找已存在的 iOS 应用
  console.log('查询 iOS 应用…');
  const list = await api('GET', `${API}/projects/${PROJECT_ID}/iosApps?pageSize=100`);
  let app = (list.apps || []).find(a => a.bundleId === BUNDLE_ID);

  // 2. 不存在则创建（长时操作，轮询）
  if (!app) {
    console.log(`创建 iOS 应用 bundleId=${BUNDLE_ID} …`);
    const op = await api('POST', `${API}/projects/${PROJECT_ID}/iosApps`, { bundleId: BUNDLE_ID, displayName: 'v信 iOS' });
    if (op.name && !op.done) {
      for (let i = 0; i < 30; i++) {
        await sleep(2000);
        const st = await api('GET', `${API}/${op.name}`);
        if (st.done) { app = st.response; break; }
      }
    } else if (op.response) {
      app = op.response;
    }
    if (!app) throw new Error('创建操作未在预期时间内完成');
    console.log('已创建:', app.appId || app.name);
  } else {
    console.log('已存在 iOS 应用:', app.appId);
  }

  const appName = app.name || `projects/${PROJECT_ID}/iosApps/${app.appId}`;

  // 3. 拉取 config(plist)
  console.log('拉取 GoogleService-Info.plist …');
  const cfg = await api('GET', `${API}/${appName}/config`);
  const plist = Buffer.from(cfg.configFileContents, 'base64').toString('utf8');
  fs.writeFileSync(OUT, plist);
  console.log('✅ 已写入', OUT);
  // 简单校验
  if (/PLACEHOLDER|vxin-placeholder/.test(plist)) console.warn('⚠️ 写入内容看起来仍是占位，请检查');
  else console.log('   内容校验: 含真实 BUNDLE/PROJECT 信息');
}

main().catch(e => {
  console.error('❌ 失败:', e.message);
  if (e.status === 403) {
    console.error('\n服务账号没有 Firebase 管理权限(无法创建/读取应用)。');
    console.error('解决: GCP 控制台 → IAM → 给该服务账号加 "Firebase Admin" 角色后重试；');
    console.error('或手动在 Firebase 控制台添加 iOS 应用(Bundle ID: com.vxin.app)下载 plist。');
  }
  process.exit(1);
});
