#!/usr/bin/env node
/**
 * smoke_test.js —— 功能冒烟测试：登录一个账号，打一圈主要接口，
 * 标记任何 5xx 或可疑的空 {}(列表接口本应返回数组)。Hermes 在服务器本机执行。
 * 需先 seed ≥1 账号。用法: node smoke_test.js <phone> [password]
 */
'use strict';
const http = require('http');
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:3002';
const U = new URL(BACKEND);
const [phone, PASS = 'Loadtest1234'] = process.argv.slice(2);
if (!phone) { console.log('用法: node smoke_test.js <phone> [password]'); process.exit(1); }

function req(method, path, { body, jar, csrf } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (jar) headers.Cookie = jar;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const r = http.request({ host: U.hostname, port: U.port, path, method, headers, agent: false }, (res) => {
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, body: buf, setCookie: res.headers['set-cookie'] || [], csrf: res.headers['x-csrf-token'] || null }));
    });
    r.on('error', () => resolve({ status: 0, body: '' }));
    if (data) r.write(data); r.end();
  });
}

function shape(body) {
  try { const j = JSON.parse(body);
    if (Array.isArray(j)) return `数组[${j.length}]`;
    const keys = Object.keys(j);
    if (keys.length === 0) return '空对象{}';
    return `对象{${keys.slice(0, 4).join(',')}${keys.length > 4 ? ',…' : ''}}`;
  } catch { return body.slice(0, 30); }
}

(async () => {
  const login = await req('POST', '/api/auth/login', { body: { phone, password: PASS } });
  if (login.status !== 200) { console.log('❌ 登录失败', login.status, login.body); process.exit(1); }
  let jar = login.cookie || login.setCookie.map(c => c.split(';')[0]).join('; ');
  const me0 = await req('GET', '/api/auth/me', { jar });
  if (me0.setCookie.length) jar = [jar, ...me0.setCookie.map(c => c.split(';')[0])].join('; ');
  const myId = JSON.parse(me0.body).id;

  // [接口, 期望形态]  expect: 'array' | 'object' | 'any'
  const GETS = [
    ['/api/auth/me', 'object'],
    ['/api/config', 'object'],
    ['/api/users/contacts', 'array'],
    ['/api/users/friend-requests', 'array'],
    ['/api/users/friend-requests/sent', 'array'],
    ['/api/users/me/blocked', 'array'],
    ['/api/users/me/settings', 'object'],
    [`/api/users/${myId}`, 'object'],          // getUserDetail(曾返回{})
    ['/api/messages/conversations', 'array'],   // listConversations(曾返回{})
    ['/api/messages/unread-counts', 'any'],
    ['/api/messages/my-groups', 'array'],
    ['/api/messages/search?q=test&limit=5', 'object'], // searchGlobal(曾返回{}) → 应有 results
    ['/api/users/friend-requests', 'array'],
    ['/api/notifications/status', 'any'],
    ['/api/users/me/collections', 'array'],
    ['/api/users/me/call-logs', 'array'],
  ];

  let warn = 0, bad = 0;
  console.log(`冒烟测试 (账号 ${phone})\n`);
  for (const [path, expect] of GETS) {
    const r = await req('GET', path, { jar });
    const sh = shape(r.body);
    let flag = '✅';
    if (r.status >= 500) { flag = '❌5xx'; bad++; }
    else if (r.status >= 400) { flag = `⚠️${r.status}`; warn++; }
    else if (expect === 'array' && !sh.startsWith('数组')) { flag = '❌应为数组却'; bad++; }
    else if (expect === 'object' && sh === '空对象{}') { flag = '❌空对象(疑未await)'; bad++; }
    console.log(`${flag}  ${r.status}  ${path}  →  ${sh}`);
  }

  // 搜索接口专项：确认 results 字段存在(await 修复后)
  const sr = await req('GET', '/api/messages/search?q=a&limit=3', { jar });
  let hasResults = false; try { hasResults = 'results' in JSON.parse(sr.body); } catch {}
  console.log(`\n搜索接口 results 字段: ${hasResults ? '✅ 存在(await已修复)' : '❌ 缺失(仍返回{})'}`);

  console.log(`\n汇总: 失败 ${bad} · 警告 ${warn}`);
  process.exit(bad > 0 ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
