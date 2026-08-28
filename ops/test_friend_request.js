#!/usr/bin/env node
/**
 * test_friend_request.js —— 验证"加好友→对方在新的朋友看到验证请求"是否正常。
 * 由 Hermes 在服务器本机执行(直连后端 3002)。需先用 seed_test_users.js 播种 ≥2 账号。
 *
 *   A(phone1) 向 B(phone2) 发好友请求 → 查 B 的 /api/users/friend-requests 是否含该请求。
 *
 * 环境: BACKEND_URL(默认 http://127.0.0.1:3002)
 * 用法: node test_friend_request.js <phoneA> <phoneB> [password]
 */
'use strict';
const http = require('http');
const { assertTouliaoBackend } = require('./_envGuard');
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:3002';
const U = new URL(BACKEND);
const [phoneA, phoneB, PASS = 'Loadtest1234'] = process.argv.slice(2);
if (!phoneA || !phoneB) { console.log('用法: node test_friend_request.js <phoneA> <phoneB> [password]'); process.exit(1); }
assertTouliaoBackend(BACKEND);

function req(method, path, { body, jar, csrf } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (jar) headers.Cookie = jar;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const r = http.request({ host: U.hostname, port: U.port, path, method, headers, agent: false }, (res) => {
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => resolve({
        status: res.statusCode, body: buf,
        cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; '),
        csrf: res.headers['x-csrf-token'] || null,
      }));
    });
    r.on('error', () => resolve({ status: 0, body: '' }));
    if (data) r.write(data); r.end();
  });
}

async function session(phone) {
  const login = await req('POST', '/api/auth/login', { body: { phone, password: PASS } });
  if (login.status !== 200) throw new Error(`登录失败 ${phone}: ${login.status} ${login.body}`);
  let jar = login.cookie;
  const me = await req('GET', '/api/auth/me', { jar });
  if (me.cookie) jar = [jar, me.cookie].filter(Boolean).join('; ');
  return { jar, csrf: me.csrf, user: JSON.parse(me.body) };
}

(async () => {
  const A = await session(phoneA);
  const B = await session(phoneB);
  console.log(`A = ${A.user.username} (${A.user.id})`);
  console.log(`B = ${B.user.username} (${B.user.id})`);

  // A 向 B 发好友请求
  const send = await req('POST', '/api/users/friend-request', { jar: A.jar, csrf: A.csrf, body: { toId: B.user.id, message: '测试验证消息' } });
  console.log(`\n[A→B 发好友请求] status=${send.status} body=${send.body}`);

  // B 查"新的朋友"(收到的请求)
  const list = await req('GET', '/api/users/friend-requests', { jar: B.jar });
  console.log(`\n[B 的 /api/users/friend-requests] status=${list.status}`);
  console.log(`  ${list.body}`);

  let arr = []; try { arr = JSON.parse(list.body); } catch (_) {}
  const found = Array.isArray(arr) && arr.some(r => r.from_id === A.user.id || r.from?.id === A.user.id);
  console.log(`\n结论: ${found ? '✅ B 能在"新的朋友"看到 A 的验证请求 —— 后端正常' : '❌ B 的列表里没有 A 的请求 —— 后端有问题'}`);
  if (!found && send.body.includes('autoAccepted')) console.log('  注: 返回 autoAccepted=true 说明 B 关闭了"加好友需验证"，被直接互加，故无验证请求(属设置, 非bug)');
  process.exit(0);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
