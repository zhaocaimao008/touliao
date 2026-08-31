#!/usr/bin/env node
'use strict';
/**
 * 1000 并发连接压测脚本 —— 验证 SQLite + WebSocket 在目标规模(1000人单机部署)下的真实表现。
 *
 * ⚠ 安全隔离：全程不碰生产 wechat.db / 生产端口 3003。
 *   把被测后端起成一个独立子进程，DB_PATH 指向压测专用的临时 SQLite 文件、
 *   端口用 3099（可用 LOADTEST_PORT 环境变量覆盖），跟 npm test 的 Jest 隔离库
 *   是同一思路，只是这里跑的是"真实生产二进制"(node src/server.js)而不是
 *   supertest 直连 app，这样测出来的内存/延迟数字才反映真实的 fork 模式进程。
 *
 * 用法：
 *   node test/ws-load-test.js
 *   CONNECTIONS=1000 CONNECT_BATCH=50 node test/ws-load-test.js
 *
 * 输出：连接建立耗时分布 / 消息投递延迟分布 / 服务端进程内存占用 / 错误率。
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { io: ioc } = require('socket.io-client');

// ── 配置 ──────────────────────────────────────────────────────
const CONNECTIONS = parseInt(process.env.CONNECTIONS || '1000', 10);
const CONNECT_BATCH = parseInt(process.env.CONNECT_BATCH || '50', 10);   // 每批并发建连数(避免压测器自身瞬时descriptor/事件循环抖动干扰测量)
const REGISTER_BATCH = parseInt(process.env.REGISTER_BATCH || '30', 10); // 每批并发造号数
const PORT = parseInt(process.env.LOADTEST_PORT || '3099', 10);
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

const ROOT = path.join(__dirname, '..');
const LOADTEST_DB = path.join(__dirname, `.tmp-loadtest-db-${Date.now()}.sqlite`);
const LOADTEST_UPLOADS = path.join(__dirname, `.tmp-loadtest-uploads-${Date.now()}`);

function nowMs() { return Number(process.hrtime.bigint() / 1000000n); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function stats(arr) {
  if (!arr.length) return { n: 0, min: NaN, max: NaN, avg: NaN, p50: NaN, p95: NaN, p99: NaN };
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: +(sum / sorted.length).toFixed(1),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}
function fmtStats(label, s, unit = 'ms') {
  if (!s.n) return `  ${label}: (无样本)`;
  return `  ${label}: n=${s.n} min=${s.min}${unit} avg=${s.avg}${unit} p50=${s.p50}${unit} p95=${s.p95}${unit} p99=${s.p99}${unit} max=${s.max}${unit}`;
}

// ── 读取子进程 RSS 内存（/proc，Linux专用；压测脚本本就跑在Linux生产机上）──
function readRssMb(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? +(parseInt(m[1], 10) / 1024).toFixed(1) : null;
  } catch { return null; }
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    }).on('error', reject);
  });
}
function httpPostJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── 1) 起一个隔离的后端子进程 ────────────────────────────────────
async function startServer() {
  for (const suf of ['', '-wal', '-shm']) { try { fs.unlinkSync(LOADTEST_DB + suf); } catch {} }
  fs.mkdirSync(LOADTEST_UPLOADS, { recursive: true });

  const env = {
    ...process.env,
    NODE_ENV: 'test',              // 与 Jest 隔离库同口径：跳过生产专属的强制项(ADMIN_*必填等)
    PORT: String(PORT),
    DB_PATH: LOADTEST_DB,
    UPLOADS_ROOT: LOADTEST_UPLOADS,
    DISABLE_CSRF: '1',
    DISABLE_RATE_LIMIT: '1',       // 压测目标是SQLite+WS吞吐/延迟，不是重新验证限流(已有专项审计覆盖)
    INVITE_CODE: '123456',
    JWT_SECRET: 'loadtest_jwt_secret_at_least_32_characters_long_x',
    ADMIN_JWT_SECRET: 'loadtest_admin_jwt_secret_at_least_32_chars_x',
    TRACING_ENABLED: 'false',
  };

  const child = spawn('node', ['src/server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderrTail = '';
  child.stderr.on('data', d => { stderrTail = (stderrTail + d.toString()).slice(-4000); });

  // 等 /health 就绪，最多 15 秒
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await httpGetJson(`${BASE_URL}/health`);
      if (r.status === 200 && r.body.ok) return { child, stderrTail: () => stderrTail };
    } catch { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('后端子进程 15 秒内未就绪，stderr 尾部：\n' + stderrTail);
}

// ── 2) 批量造号 + 互加好友（消息延迟测试需要真实会话）───────────────
async function registerUsersInBatches(n, batchSize) {
  const users = [];
  for (let i = 0; i < n; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, n); j++) {
      batch.push(httpPostJson(`${BASE_URL}/api/auth/register`, {
        // 9位索引零填充，保证 CONNECTIONS<=999999999 范围内绝不与其它 j 冲突
        phone: `+86-139${String(j).padStart(8, '0')}`,
        password: 'loadtestPassw0rd',
        username: `lt_${j}_${Date.now() % 100000}`,
        inviteCode: '123456',
      }).then(r => {
        if (r.status !== 200) throw new Error(`注册失败 idx=${j} status=${r.status} ${JSON.stringify(r.body)}`);
        users.push({ idx: j, token: r.body.token, userId: r.body.user.id });
      }));
    }
    await Promise.all(batch);
    process.stdout.write(`\r  造号进度: ${Math.min(i + batchSize, n)}/${n}`);
  }
  process.stdout.write('\n');
  users.sort((a, b) => a.idx - b.idx);
  return users;
}

/** 两两配对互为好友，建私聊会话；返回 users 上挂 peer/conversationId */
async function befriendPairs(users) {
  for (let i = 0; i + 1 < users.length; i += 2) {
    const a = users[i], b = users[i + 1];
    await httpPostJson(`${BASE_URL}/api/users/friend-request`, { toId: b.userId }, { Authorization: `Bearer ${a.token}` });
    const recv = await httpGetJson(`${BASE_URL}/api/users/friend-requests`); // 占位，真正需要带 token，下面单独查
    const listRes = await new Promise((resolve, reject) => {
      const req = http.request(`${BASE_URL}/api/users/friend-requests`, { headers: { Authorization: `Bearer ${b.token}` } }, res => {
        let body = ''; res.on('data', c => body += c); res.on('end', () => resolve(JSON.parse(body || '[]')));
      });
      req.on('error', reject); req.end();
    });
    const reqId = listRes.find(r => r.from_id === a.userId)?.id;
    if (!reqId) continue;
    await httpPostJson(`${BASE_URL}/api/users/friend-request/${reqId}/handle`, { action: 'accept' }, { Authorization: `Bearer ${b.token}` });
    const conv = await httpPostJson(`${BASE_URL}/api/messages/conversation/private`, { userId: b.userId }, { Authorization: `Bearer ${a.token}` });
    a.peer = b; b.peer = a;
    a.conversationId = conv.body.conversationId; b.conversationId = conv.body.conversationId;
  }
  return users.filter(u => u.conversationId);
}

// ── 3) 并发建连，记录每条连接的握手耗时 ───────────────────────────
function connectOne(user) {
  return new Promise((resolve) => {
    const t0 = nowMs();
    const s = ioc(BASE_URL, {
      transports: ['websocket'],
      auth: { token: user.token },
      reconnection: false,
      timeout: 8000,
    });
    const done = (ok, err) => {
      s.off('connect'); s.off('connect_error');
      resolve({ ok, ms: nowMs() - t0, socket: ok ? s : null, err: err ? String(err.message || err) : null });
    };
    s.on('connect', () => done(true));
    s.on('connect_error', (err) => done(false, err));
  });
}

// realtime/index.js 的 per-IP 握手限流是 60s 窗口最多 30 次（IP_HANDSHAKE_MAX），
// 压测脚本所有连接都从同一台机器（同一 source IP）发起，天然会撞上这道防护——
// 这本身是一个真实、有价值的发现（见压测报告末尾说明），但要拿到"1000并发"这个
// 目标规模下SQLite/WS真实表现的数字，需要按这个窗口节流，不能绕过/修改业务代码。
const IP_WINDOW_MS = 61_000;      // 略大于服务端60s窗口，留安全余量
const IP_WINDOW_MAX = 28;         // 略小于服务端30次上限，留安全余量（服务端判断用 >=）

async function connectInBatches(users, batchSize) {
  const effectiveBatch = Math.min(batchSize, IP_WINDOW_MAX);
  const results = [];
  for (let i = 0; i < users.length; i += effectiveBatch) {
    if (i > 0) {
      process.stdout.write(`\n  （等待 per-IP 握手频率窗口重置 ${IP_WINDOW_MS / 1000}s...）`);
      await sleep(IP_WINDOW_MS);
    }
    const batch = users.slice(i, i + effectiveBatch);
    const batchResults = await Promise.all(batch.map(connectOne));
    results.push(...batchResults);
    process.stdout.write(`\r  建连进度: ${Math.min(i + effectiveBatch, users.length)}/${users.length}          `);
  }
  process.stdout.write('\n');
  return results;
}

// ── 4) 全部连上后，两两互发一条消息，测端到端投递延迟 + ack延迟 ─────
async function measureMessageLatency(connected /* [{user, socket}] */) {
  const bySocketUserId = new Map(connected.map(c => [c.user.userId, c]));
  const ackLatencies = [];
  const deliverLatencies = [];
  const errors = [];

  // 先给每个接收方挂监听，记录收到时刻。broadcaster.js 有5ms合并窗口，
  // 单条消息走 new_message，同窗口内多条会合并成 new_message_batch(数组)，两种都要接住。
  const recvAt = new Map(); // clientMsgId → recvTs
  const mark = (msg) => { if (msg && msg.client_msg_id) recvAt.set(msg.client_msg_id, nowMs()); };
  for (const c of connected) {
    c.socket.on('new_message', mark);
    c.socket.on('new_message_batch', (arr) => { (arr || []).forEach(mark); });
  }

  const sendPromises = connected
    .filter(c => c.user.peer && bySocketUserId.has(c.user.peer.userId))
    .map(c => new Promise((resolve) => {
      const clientMsgId = `lt-${c.user.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const t0 = nowMs();
      const timer = setTimeout(() => { errors.push(`ack超时 user=${c.user.userId}`); resolve(); }, 8000);
      c.socket.emit('send_message', {
        conversationId: c.user.conversationId,
        content: `压测消息 ${clientMsgId}`,
        clientMsgId,
      }, (ack) => {
        clearTimeout(timer);
        const ackMs = nowMs() - t0;
        if (!ack || ack.success !== true) { errors.push(`ack失败 user=${c.user.userId} ${JSON.stringify(ack)}`); resolve(); return; }
        ackLatencies.push(ackMs);
        // 等一小会儿看对端是否已经收到（socket.io批量派发窗口5ms，留200ms足够）
        setTimeout(() => {
          const rt = recvAt.get(clientMsgId);
          if (rt) deliverLatencies.push(rt - t0);
          resolve();
        }, 200);
      });
    }));

  await Promise.all(sendPromises);
  return { ackLatencies, deliverLatencies, errors };
}

// ── main ──────────────────────────────────────────────────────
(async () => {
  console.log(`\n投聊 WebSocket + SQLite 压测 —— 目标并发 ${CONNECTIONS}`);
  console.log(`隔离环境：DB=${LOADTEST_DB}  PORT=${PORT}（不触碰生产 wechat.db / 生产端口3003）\n`);

  console.log('▶ 启动隔离后端子进程...');
  const { child, stderrTail } = await startServer();
  console.log(`✅ 后端就绪 pid=${child.pid}`);
  await sleep(300);
  const baselineRss = readRssMb(child.pid);
  console.log(`  基线内存 RSS ≈ ${baselineRss} MB\n`);

  let connected = [];
  let connectResults = [];
  let msgResult = { ackLatencies: [], deliverLatencies: [], errors: [] };
  let users = [];

  try {
    console.log(`▶ 批量注册 ${CONNECTIONS} 个测试账号（每批${REGISTER_BATCH}并发）...`);
    const tReg0 = nowMs();
    users = await registerUsersInBatches(CONNECTIONS, REGISTER_BATCH);
    console.log(`✅ 注册完成 ${users.length}/${CONNECTIONS}，耗时 ${nowMs() - tReg0}ms\n`);

    console.log('▶ 两两互加好友 + 建私聊会话（用于消息延迟测试）...');
    const tFriend0 = nowMs();
    const friended = await befriendPairs(users);
    console.log(`✅ 配对完成 ${friended.length} 个用户有可用会话，耗时 ${nowMs() - tFriend0}ms\n`);

    // 造号阶段(1000次bcrypt哈希+SQLite写入)本身会把进程堆占用推高一截，若拿"进程刚起时"的
    // baselineRss 去算"建连阶段"的内存增量，会把造号阶段的残留占用也算进WS连接头上，失真。
    // 这里在造号+配对都结束、GC有机会喘口气之后，重新采一次基线，专门用于建连阶段的对比。
    await sleep(1000);
    if (global.gc) global.gc();
    const preConnectRss = readRssMb(child.pid);
    console.log(`  造号完成后(建连前)内存 RSS ≈ ${preConnectRss} MB（用于下面"建连阶段"增量对比，避免把造号阶段的占用算到WS连接头上）\n`);

    console.log(`▶ 并发建立 WebSocket 连接（每批${CONNECT_BATCH}并发，受服务端per-IP握手频率限制节流）...`);
    const tConn0 = nowMs();
    connectResults = await connectInBatches(users, CONNECT_BATCH);
    const connectWallMs = nowMs() - tConn0;
    connected = connectResults.filter(r => r.ok).map(r => ({ user: users[connectResults.indexOf(r)], socket: r.socket }));
    console.log(`✅ 建连完成，成功 ${connected.length}/${users.length}，总耗时 ${connectWallMs}ms\n`);

    const rssAfterConnect = readRssMb(child.pid);
    console.log(`  全部连上后内存 RSS ≈ ${rssAfterConnect} MB（较造号后基线 +${(rssAfterConnect - preConnectRss).toFixed(1)} MB）\n`);

    console.log('▶ 全部连上后，两两互发一条消息，测量 ack 延迟与端到端投递延迟...');
    const tMsg0 = nowMs();
    msgResult = await measureMessageLatency(connected);
    console.log(`✅ 消息压测完成，耗时 ${nowMs() - tMsg0}ms\n`);

    await sleep(300);
    const rssAfterMsg = readRssMb(child.pid);

    // ── 汇总报告 ──────────────────────────────────────────────
    const connectOkMs = connectResults.filter(r => r.ok).map(r => r.ms);
    const connectFailCount = connectResults.filter(r => !r.ok).length;

    console.log('═'.repeat(70));
    console.log('压测报告');
    console.log('═'.repeat(70));
    console.log(`\n【连接建立耗时】（${connected.length}/${CONNECTIONS} 成功，失败 ${connectFailCount} 条）`);
    console.log(fmtStats('单连接握手耗时', stats(connectOkMs)));
    console.log(`  全部${CONNECTIONS}条连接建完的总墙钟耗时: ${connectWallMs}ms`);

    console.log(`\n【消息延迟】（发送方${msgResult.ackLatencies.length}条ack成功，投递确认${msgResult.deliverLatencies.length}条，错误${msgResult.errors.length}条）`);
    console.log(fmtStats('发送→服务端ack确认', stats(msgResult.ackLatencies)));
    console.log(fmtStats('发送→对端收到(端到端)', stats(msgResult.deliverLatencies)));

    console.log(`\n【服务端进程内存占用】(RSS, node --max-old-space-size=1024)`);
    console.log(`  基线(进程刚启动，空载): ${baselineRss} MB`);
    console.log(`  造号${users.length}个账号+配对完成后(建连前): ${preConnectRss} MB`);
    console.log(`  ${connected.length}条WS连接全部建立后: ${rssAfterConnect} MB`);
    console.log(`  ${msgResult.ackLatencies.length}条消息发送完成后: ${rssAfterMsg} MB`);
    console.log(`  人均内存增量(仅建连阶段，已剔除造号阶段占用): ${connected.length ? ((rssAfterConnect - preConnectRss) * 1024 / connected.length).toFixed(1) : 'N/A'} KB/连接`);

    const totalAttempts = CONNECTIONS + msgResult.ackLatencies.length + msgResult.errors.length;
    const totalErrors = connectFailCount + msgResult.errors.length + (CONNECTIONS - users.length);
    console.log(`\n【错误率】`);
    console.log(`  造号失败: ${CONNECTIONS - users.length}/${CONNECTIONS}`);
    console.log(`  建连失败: ${connectFailCount}/${CONNECTIONS}`);
    console.log(`  消息发送失败(ack失败或超时): ${msgResult.errors.length}`);
    console.log(`  综合错误率: ${((totalErrors / totalAttempts) * 100).toFixed(2)}%`);
    if (msgResult.errors.length) console.log(`  错误样本: ${msgResult.errors.slice(0, 5).join(' | ')}`);
    console.log('\n' + '═'.repeat(70));

  } catch (e) {
    console.error('\n❌ 压测过程出错:', e.message);
    console.error('后端子进程 stderr 尾部:\n', stderrTail());
  } finally {
    console.log('\n▶ 清理：断开全部连接、关闭子进程、删除临时库...');
    for (const c of connected) { try { c.socket.close(); } catch {} }
    await sleep(300);
    try { child.kill('SIGTERM'); } catch {}
    await sleep(500);
    for (const suf of ['', '-wal', '-shm']) { try { fs.unlinkSync(LOADTEST_DB + suf); } catch {} }
    try { fs.rmSync(LOADTEST_UPLOADS, { recursive: true, force: true }); } catch {}
    console.log('✅ 清理完成\n');
    process.exit(0);
  }
})();
