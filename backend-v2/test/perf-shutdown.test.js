'use strict';
/**
 * 优雅退出回归（2026-10-11）：src/server.js 的 graceful()。
 *
 * 修复前：graceful() 先 shutdownWriter()、从不调用 io.close() —— 已升级的 WebSocket 让
 * server.close() 回调永不触发，只能等 3s 兜底；而生产 pm2 用默认 kill_timeout 1600ms，
 * 于是每次重启都被 SIGKILL。在线用户的 disconnect handler 也从没跑过，status 停在 'online'。
 *
 * 断言（任一项在旧代码上都会失败或暴露回归）：
 *   1. SIGTERM 后在 1600ms（pm2 默认 kill_timeout）内以 code 0 自行退出，而不是被信号杀死；
 *   2. 客户端断线原因是 'transport close'（会自动重连）——若有人改成
 *      io.disconnectSockets(true)，这里会变成 'io server disconnect'（客户端不重连）；
 *   3. io.close() 触发的下线写入在 writer 关闭前落盘：库里 status 变为 'offline'。
 *
 * 做法对齐 test/ws-load-test.js（真实 node src/server.js 子进程 + 独立临时库/端口）与
 * core-ws-auth.test.js（socket.io-client 建连）。子进程必须用独立 DB_PATH：整机启动会把库里
 * online 用户全部置 offline、收尾悬挂通话、扫红包/阅后即焚，不能碰其它套件共享的测试库。
 */
require('./testEnv');
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { io: ioc } = require('socket.io-client');
const legalConsent = require('./legal-consent.cjs');

const ROOT = path.join(__dirname, '..');
const PM2_DEFAULT_KILL_TIMEOUT_MS = 1600;

let dir, child, port, probe;
let stdoutTail = '', stderrTail = '';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tails = () => `\n--- server stdout ---\n${stdoutTail}\n--- server stderr ---\n${stderrTail}`;
const alive = () => child && child.exitCode === null && child.signalCode === null;

// 取空闲端口（同 shared-rate-limit.test.js）
function freePort() {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// 同 ws-load-test.js 的 httpGetJson/httpPostJson：http 模块直连子进程
function httpJson(method, urlPath, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = payload == null ? null : JSON.stringify(payload);
    const req = http.request(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      agent: false, // 不留 keep-alive 连接
      timeout: 5000,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
        : headers,
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// 等 /health 就绪（同 ws-load-test.js startServer）
async function waitHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive()) throw new Error('server.js 子进程启动即退出' + tails());
    try {
      const r = await httpJson('GET', '/health');
      if (r.status === 200 && r.body.ok) return;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error(`server.js 子进程 ${timeoutMs}ms 内未就绪` + tails());
}

// 注册载荷与 helpers.makeUser 一致（helpers 绑定的是进程内 app/共享库，这里打到子进程）
async function makeUser() {
  const uniq = `${Date.now().toString().slice(-7)}1`;
  const user = {
    phone: `+86-13${uniq}`.slice(0, 18),
    password: 'passw0rd123456',
    username: `u_${uniq}`,
    inviteCode: process.env.INVITE_CODE || '123456',
    legalConsent,
  };
  const res = await httpJson('POST', '/api/auth/register', user);
  if (res.status >= 400) throw new Error(`makeUser 注册失败 ${res.status}: ${JSON.stringify(res.body)}`);
  return { token: res.body.token, userId: res.body.user.id };
}

// 同 core-ws-auth.test.js connect()
function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioc(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 5000,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', err => { s.close(); reject(err); });
  });
}

beforeAll(async () => {
  if (process.platform === 'win32') return; // Windows 无法向子进程投递可捕获的 SIGTERM
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-shutdown-'));
  port = await freePort();
  // 一个已关闭的端口：redisCache 固定按 REDIS_HOST/REDIS_PORT 建连，绝不能碰本机真实 Redis
  const deadRedisPort = await freePort();
  child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      PORT_V2: String(port),
      DB_PATH: path.join(dir, 'shutdown.sqlite'),
      UPLOADS_ROOT: path.join(dir, 'uploads'),
      LOG_DIR: path.join(dir, 'logs'),
      TRACING_ENABLED: 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
      SENTRY_DSN: '',
      REDIS_URL: '',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(deadRedisPort),
      FORCE_SYNC_WRITES: '0', // 走真实 worker 写入路径：验证的正是「入队 → shutdownWriter 落盘」顺序
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 必须持续读走管道，否则子进程同步写 stdout 会在管道满时阻塞
  child.stdout.on('data', d => { stdoutTail = (stdoutTail + d.toString()).slice(-4000); });
  child.stderr.on('data', d => { stderrTail = (stderrTail + d.toString()).slice(-4000); });
  await waitHealthy(25000);
  probe = new Database(path.join(dir, 'shutdown.sqlite'), { fileMustExist: true });
}, 40000);

afterAll(async () => {
  try { probe?.close(); } catch {}
  if (alive()) {
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); });
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const maybe = process.platform === 'win32' ? test.skip : test;

maybe('SIGTERM：io.close() 断开 socket、下线写入落盘、1600ms 内以 code 0 自行退出', async () => {
  const u = await makeUser();
  const s = await connect(u.token);
  try {
    const reason = new Promise(resolve => s.once('disconnect', resolve));
    const status = () => probe.prepare('SELECT status FROM users WHERE id=?').get(u.userId)?.status;

    // 前置：上线写入（worker fire-and-forget）已落盘
    const t0 = Date.now();
    while (status() !== 'online' && Date.now() - t0 < 5000) await sleep(50);
    expect(status()).toBe('online');
    expect(alive()).toBe(true);

    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const start = Date.now();
    child.kill('SIGTERM');
    const { code, signal } = await exited;
    const elapsed = Date.now() - start;
    if (code !== 0 || signal !== null || elapsed >= PM2_DEFAULT_KILL_TIMEOUT_MS) console.error(tails());

    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(elapsed).toBeLessThan(PM2_DEFAULT_KILL_TIMEOUT_MS);
    expect(await Promise.race([reason, sleep(3000).then(() => 'no-disconnect')])).toBe('transport close');
    expect(status()).toBe('offline');
  } finally {
    s.close();
  }
}, 30000);
