#!/usr/bin/env node
const operationalConsent = require('./legal-consent.cjs');
/**
 * test_switch.js —— 验证"丝滑切换账号(免密)"。Hermes 在服务器本机执行(直连3002)。
 * 需先 seed ≥2 账号。流程：
 *   同一 wallet 下依次登录 A、B(都被记入本设备钱包) → 调 /api/auth/switch 切回 A
 *   → 应免密返回 A 的用户信息(/me 确认当前是 A)。
 * 用法: node test_switch.js <phoneA> <phoneB> [password]
 */
'use strict';
const http = require('http');
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:3002';
const U = new URL(BACKEND);
const [phoneA, phoneB, PASS = 'Loadtest1234'] = process.argv.slice(2);
if (!phoneA || !phoneB) { console.log('用法: node test_switch.js <phoneA> <phoneB> [password]'); process.exit(1); }

function req(method, path, { body, jar, csrf } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (jar && Object.keys(jar).length) headers.Cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const r = http.request({ host: U.hostname, port: U.port, path, method, headers, agent: false }, (res) => {
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, body: buf, setCookie: res.headers['set-cookie'] || [], csrf: res.headers['x-csrf-token'] || null }));
    });
    r.on('error', () => resolve({ status: 0, body: '' }));
    if (data) r.write(data); r.end();
  });
}
function merge(jar, setCookie = []) { for (const c of setCookie) { const [p] = c.split(';'); const i = p.indexOf('='); jar[p.slice(0, i)] = p.slice(i + 1); } return jar; }

(async () => {
  const jar = {};
  // 登录 A（首登会下发 wallet cookie）
  let r = await req('POST', '/api/auth/login', { body: { legalConsent: operationalConsent(), phone: phoneA, password: PASS }, jar }); merge(jar, r.setCookie);
  if (r.status !== 200) { console.log('❌ 登录A失败', r.status, r.body); process.exit(1); }
  let me = await req('GET', '/api/auth/me', { jar }); merge(jar, me.setCookie);
  const idA = JSON.parse(me.body).id;
  console.log(`登录 A: ${JSON.parse(me.body).username} (${idA})  wallet=${jar['vxin_wallet'] ? '已下发' : '无'}`);

  // 同一 wallet 登录 B
  r = await req('POST', '/api/auth/login', { body: { legalConsent: operationalConsent(), phone: phoneB, password: PASS }, jar }); merge(jar, r.setCookie);
  me = await req('GET', '/api/auth/me', { jar }); merge(jar, me.setCookie);
  const idB = JSON.parse(me.body).id; const csrfB = me.csrf || jar['csrf_token'];
  console.log(`登录 B: ${JSON.parse(me.body).username} (${idB})  当前会话=${JSON.parse(me.body).username}`);

  // 免密切回 A
  const sw = await req('POST', '/api/auth/switch', { jar, csrf: csrfB, body: { userId: idA } }); merge(jar, sw.setCookie);
  console.log(`\n[POST /api/auth/switch → A] status=${sw.status} body=${sw.body}`);

  // /me 确认当前已是 A（且全程没输 A 的密码）
  me = await req('GET', '/api/auth/me', { jar });
  const now = JSON.parse(me.body || '{}');
  const ok = sw.status === 200 && now.id === idA;
  console.log(`\n切换后 /me = ${now.username} (${now.id})`);
  console.log(`结论: ${ok ? '✅ 免密丝滑切换成功(全程未再输密码)' : '❌ 切换失败'}`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
