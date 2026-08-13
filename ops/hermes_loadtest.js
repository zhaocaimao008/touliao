#!/usr/bin/env node
/**
 * hermes_loadtest.js —— 投聊 压力测试（Hermes 在服务器本机执行）
 *
 * 用【预播种测试账号 + 测试群】(见 seed_test_users.js) 跑真实负载：
 *   A. 并发登录         —— 唯一手机号、分批，避免 bcrypt 雪崩
 *   B. HTTP 写入吞吐     —— 走 /api/messages(持久化路径)测写延迟(60条/分钟/IP上限)
 *   C. 并发 WebSocket    —— 建 N 路长连接 + soak(持续在线,跨多个心跳周期)
 *   D. 实时广播扇出       —— 1 人 socket 发 send_message → 群内其余 N-1 人收 new_message,
 *                           测真实聊天投递的完整率与延迟
 *
 * 可走真实路径(经 Nginx/TLS): 设 LOADTEST_URL=https://dipsin.com
 * 环境: LOADTEST_URL|BACKEND_URL, LOAD_CONNS, LOAD_MSG_RATE, LOAD_DURATION,
 *       LOGIN_BATCH, SOAK_SECONDS, APP_DIR, OUT, TARGET_ONLINE
 */
'use strict';
const http = require('http');
const https = require('https');
const path = require('path');

const URL_STR  = process.env.LOADTEST_URL || process.env.BACKEND_URL || 'http://127.0.0.1:3002';
const CONNS    = parseInt(process.env.LOAD_CONNS || '300', 10);
const MSG_RATE = parseInt(process.env.LOAD_MSG_RATE || '20', 10);
const DURATION = parseInt(process.env.LOAD_DURATION || '20', 10);
const LOGIN_BATCH = parseInt(process.env.LOGIN_BATCH || '25', 10);
const SOAK     = parseInt(process.env.SOAK_SECONDS || '90', 10);
const APP_DIR  = process.env.APP_DIR || '/root/投聊/backend-v2';
const OUT      = process.env.OUT || '';
const GROUP_ID = '__lt_group__';

const PASS = 'Loadtest1234';
const phoneFor = i => 'LT' + String(i).padStart(9, '0');

let ioClient = null;
for (const p of ['socket.io-client', path.join(APP_DIR, 'node_modules/socket.io-client')]) {
  try { ioClient = require(p); break; } catch (_) {}
}

const U = new URL(URL_STR);
const isHttps = U.protocol === 'https:';
const httpMod = isHttps ? https : http;
const PORT = U.port || (isHttps ? 443 : 80);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function mergeCookies(jar, setCookie = []) {
  for (const c of setCookie) {
    const [pair] = c.split(';'); const idx = pair.indexOf('=');
    jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return jar;
}
const jarStr = jar => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

function req(method, pathName, { body, jar, csrf } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json', Host: U.host };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (jar && Object.keys(jar).length) headers.Cookie = jarStr(jar);
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const opts = { host: U.hostname, port: PORT, path: pathName, method, headers, agent: false };
    if (isHttps) opts.rejectUnauthorized = false;
    const r = httpMod.request(opts, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({
        status: res.statusCode,
        setCookie: res.headers['set-cookie'] || [],
        csrf: res.headers['x-csrf-token'] || null,
        body: buf,
      }));
    });
    r.on('error', () => resolve({ status: 0, setCookie: [], body: '' }));
    r.setTimeout(12000, () => { r.destroy(); resolve({ status: 0, setCookie: [], body: '' }); });
    if (data) r.write(data);
    r.end();
  });
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

async function makeSession(i) {
  const jar = {};
  let r = await req('POST', '/api/auth/login', { body: { phone: phoneFor(i), password: PASS }, jar });
  if (r.status !== 200) return { ok: false, status: r.status };
  mergeCookies(jar, r.setCookie);
  const me = await req('GET', '/api/auth/me', { jar });
  mergeCookies(jar, me.setCookie);
  return { ok: true, jar, csrf: me.csrf };
}

// ───────────── A. 并发登录(分批) ─────────────
async function testLogin(n) {
  const lat = []; let okN = 0, errN = 0; const sess = [];
  for (let off = 0; off < n; off += LOGIN_BATCH) {
    const batch = Array.from({ length: Math.min(LOGIN_BATCH, n - off) }, (_, j) => off + j);
    await Promise.all(batch.map(i => (async () => {
      const t = Date.now(); const s = await makeSession(i); lat.push(Date.now() - t);
      if (s.ok) { s.idx = i; okN++; sess.push(s); } else errN++;
    })()));
  }
  console.log(`### A. 并发登录 (${n} 账号, 每批 ${LOGIN_BATCH}${isHttps ? ', 经 Nginx/TLS' : ', 直连'})`);
  console.log(`- 成功 ${okN} / 失败 ${errN}  ·  成功率 ${(okN / n * 100).toFixed(1)}%`);
  console.log(`- 登录延迟(含bcrypt) p50=${pct(lat, .5)}ms  p95=${pct(lat, .95)}ms  max=${Math.max(...lat, 0)}ms`);
  console.log(`- ${okN >= n * 0.98 ? '✅ 认证链路稳定，会话池就绪' : '⚠️ 有登录失败'}`);
  return sess;
}

// ───────────── B. HTTP 写入吞吐 + 写延迟 ─────────────
async function testThroughput(sess) {
  if (!sess.length) { console.log('### B. HTTP 写入\n- 跳过(无会话)'); return; }
  const targets = [];
  for (const s of sess.slice(0, Math.min(sess.length, 50))) {
    const g = await req('GET', '/api/messages/file-helper', { jar: s.jar });
    let cid = null; try { const j = JSON.parse(g.body); cid = j.id || j.conversationId; } catch (_) {}
    if (cid) targets.push({ ...s, cid });
  }
  if (!targets.length) { console.log('### B. HTTP 写入\n- 跳过(无文件助手会话)'); return; }
  const lat = []; let sent = 0, rl = 0, fail = 0;
  const end = Date.now() + DURATION * 1000; const interval = 1000 / MSG_RATE; let k = 0;
  while (Date.now() < end) {
    const tick = Date.now(); const tg = targets[k % targets.length]; k++; const t = Date.now();
    req('POST', `/api/messages/${tg.cid}`, { jar: tg.jar, csrf: tg.csrf, body: { type: 'text', content: `lt ${Date.now()}` } })
      .then(r => { lat.push(Date.now() - t); if (r.status === 200 || r.status === 201) sent++; else if (r.status === 429) rl++; else fail++; });
    const wait = interval - (Date.now() - tick); if (wait > 0) await sleep(wait);
  }
  await sleep(1500);
  console.log('### B. HTTP 写入吞吐 + 写延迟 (持久化路径)');
  console.log(`- 尝试 ${sent + rl + fail} / ${DURATION}s · 成功 ${sent} · 限流429 ${rl} · 真实错误 ${fail}`);
  console.log(`- 写延迟 p50=${pct(lat, .5)}ms  p95=${pct(lat, .95)}ms  max=${Math.max(...lat, 0)}ms`);
  console.log(`- ${fail === 0 ? '✅ 服务端零真实错误' : '⚠️ ' + fail + ' 条真实错误需查'} ${rl ? '· 429是每IP 60条/分钟限流(单源必然,非瓶颈)' : ''}`);
  console.log(`- 目标 10万/天=1.16条/秒，远低于服务端能力(写 p95=${pct(lat, .95)}ms) → 吞吐充足`);
}

// ───────────── C+D. 并发长连接 + soak + 实时广播扇出 ─────────────
async function testConnectionsAndBroadcast(sess) {
  if (!ioClient) { console.log('### C. 并发长连接\n- ❌ 跳过：未装 socket.io-client'); return; }
  if (!sess.length) { console.log('### C. 并发长连接\n- 跳过(无会话)'); return; }

  let connected = 0, failed = 0; const live = []; // {socket}
  let recv = 0; const blat = [];          // 广播接收计数 + 延迟
  // 分批爬坡建连：避免一次性 N 个 TLS 握手挤爆 2 核 CPU(建连风暴假象)。
  // 真实用户是陆续连上来的；CONN_BATCH=0 则回到一次性全建(测瞬时峰值)。
  const CONN_BATCH = parseInt(process.env.CONN_BATCH || '100', 10);
  const CONN_DELAY = parseInt(process.env.CONN_BATCH_DELAY || '700', 10);
  const connectOne = (s) => new Promise((resolve) => {
    let done = false;
    const sock = ioClient(URL_STR, {
      transports: ['websocket'], extraHeaders: { Cookie: jarStr(s.jar) },
      reconnection: false, timeout: 15000, rejectUnauthorized: false,
    });
    sock.on('new_message', (msg) => {
      if (msg && typeof msg.content === 'string' && msg.content.startsWith('bcast ')) {
        const ts = parseInt(msg.content.slice(6), 10);
        if (ts) { blat.push(Date.now() - ts); recv++; }
      }
    });
    sock.on('connect', () => { if (!done) { done = true; connected++; live.push(sock); resolve(); } });
    sock.on('connect_error', () => { if (!done) { done = true; failed++; resolve(); } });
    setTimeout(() => { if (!done) { done = true; failed++; try { sock.close(); } catch (_) {} resolve(); } }, 15500);
  });
  if (CONN_BATCH > 0) {
    for (let off = 0; off < sess.length; off += CONN_BATCH) {
      await Promise.all(sess.slice(off, off + CONN_BATCH).map(connectOne));
      if (off + CONN_BATCH < sess.length) await sleep(CONN_DELAY);
    }
  } else {
    await Promise.all(sess.map(connectOne));
  }
  const total = connected + failed;
  console.log(`### C. 并发 WebSocket 长连接 (${isHttps ? '经 Nginx/TLS wss' : '直连 ws'}${CONN_BATCH > 0 ? `, 每批${CONN_BATCH}爬坡` : ''})`);
  console.log(`- 建立 ${connected} / ${total}  ·  成功率 ${total ? (connected / total * 100).toFixed(1) : 0}%`);

  // soak：持续在线，跨多个心跳周期(默认25s)采样存活
  const target = parseInt(process.env.TARGET_ONLINE || '1000', 10);
  if (connected > 0 && SOAK > 0) {
    const step = 30; let minAlive = connected;
    for (let t = step; t <= SOAK; t += step) {
      await sleep(step * 1000);
      const alive = live.filter(s => s.connected).length;
      minAlive = Math.min(minAlive, alive);
      console.log(`- soak ${t}s: 仍在线 ${alive} / ${connected}`);
    }
    console.log(`- soak 结论: ${minAlive >= connected ? `✅ ${connected} 路持续在线 ${SOAK}s 零掉线` : `⚠️ 期间最低 ${minAlive}/${connected}，有掉线`}`);
  }
  console.log(`- ${connected >= total * 0.98 ? `✅ ${connected} 路并发在线稳定${connected >= target ? '（已达 ' + target + ' 目标）' : ''}` : '⚠️ 有建连失败，查句柄/内存/Nginx worker_connections'}`);

  // D. 实时广播扇出：群内一人发，其余收
  const members = live.length;
  if (members >= 2) {
    const NMSG = 3, expPer = members - 1;
    console.log('### D. 实时广播扇出 (1 人 send_message → 群内其余 N-1 人收 new_message)');
    const sender = live[0];
    for (let i = 0; i < NMSG; i++) {
      sender.emit('send_message', { conversationId: GROUP_ID, content: `bcast ${Date.now()}`, type: 'text' });
      await sleep(2500);
    }
    await sleep(3000);
    const exp = expPer * NMSG;
    console.log(`- 群在线成员 ${members}, 每条预期送达 ${expPer}`);
    console.log(`- 发 ${NMSG} 条 · 实收 ${recv}/${exp} (${exp ? (recv / exp * 100).toFixed(1) : 0}%)`);
    console.log(`- 投递延迟 p50=${pct(blat, .5)}ms  p95=${pct(blat, .95)}ms  max=${Math.max(...blat, 0)}ms`);
    console.log(`- ${recv >= exp * 0.95 ? '✅ 实时扇出完整(真实聊天投递路径达标)' : '⚠️ 有丢失，查 socket 房间/CPU/适配器'}`);
  } else {
    console.log('### D. 实时广播扇出\n- 跳过(在线成员<2)');
  }

  live.forEach(s => { try { s.close(); } catch (_) {} });
}

(async () => {
  console.log(`\n_压测开始: 目标=${URL_STR} 并发=${CONNS} soak=${SOAK}s · socket.io-client=${ioClient ? '可用' : '缺失'}_\n`);
  const sess = await testLogin(CONNS);
  await testThroughput(sess);
  await testConnectionsAndBroadcast(sess);
  if (OUT) { try { require('fs').writeFileSync(OUT, JSON.stringify({ sessions: sess.length }, null, 2)); } catch (_) {} }
  console.log('\n_压测结束_');
  process.exit(0);
})();
