'use strict';
/**
 * WebSocket 压缩回归（2026-10-11）：src/server.js 的 Socket.IO 选项 perMessageDeflate: false。
 *
 * 修复前：perMessageDeflate 开着（serverNoContextTakeover + threshold 512），ws 8.x 下每条连接
 * 首次收/发大帧后常驻约 300KB zlib 原生状态直到断线（no_context_takeover 只 reset 不释放），
 * 并且 engine.io 因此不走 wsPreEncodedFrame，房间广播要逐 socket 成帧 + 压缩。
 *
 * 断言：客户端照常报价 permessage-deflate 时，握手仍成功（101），但服务端 101 应答里不带
 * Sec-WebSocket-Extensions——即没有协商压缩，连接上不会建 zlib 流。旧配置下该头存在，用例失败。
 * 两种报价都覆盖：浏览器/Electron 式（带 client_max_window_bits）与不带参数式（OkHttp 等）。
 *
 * 选项写在 startServer() 内部、没有导出，所以和 perf-shutdown.test.js 一样起真实的
 * node src/server.js 子进程（独立临时库/端口/死 Redis 端口），用裸 HTTP Upgrade 精确控制报价头。
 */
require('./testEnv');
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

let dir, child, port;
let stdoutTail = '', stderrTail = '';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tails = () => `\n--- server stdout ---\n${stdoutTail}\n--- server stderr ---\n${stderrTail}`;
const alive = () => child && child.exitCode === null && child.signalCode === null;

// 取空闲端口（同 perf-shutdown.test.js）
function freePort() {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// 同 perf-shutdown.test.js 的 httpJson：http 模块直连子进程
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

// 等 /health 就绪（同 perf-shutdown.test.js）
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

// 裸 WebSocket 握手：不借 socket.io-client/ws，才能精确控制 Sec-WebSocket-Extensions 报价。
// 只看握手应答头，拿到后立即断开（engine.io 侧按 transport close 清理，不会进 io.use 鉴权）。
function wsHandshake(extensionsOffer) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`, {
      agent: false,
      timeout: 5000,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Extensions': extensionsOffer,
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode, headers: res.headers });
    });
    // 非 101（例如扩展协商被拒的 400）走普通 response
    req.on('response', res => { res.resume(); resolve({ status: res.statusCode, headers: res.headers }); });
    req.on('timeout', () => req.destroy(new Error('handshake timeout')));
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-deflate-'));
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
      DB_PATH: path.join(dir, 'deflate.sqlite'),
      UPLOADS_ROOT: path.join(dir, 'uploads'),
      LOG_DIR: path.join(dir, 'logs'),
      TRACING_ENABLED: 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
      SENTRY_DSN: '',
      REDIS_URL: '',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(deadRedisPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 必须持续读走管道，否则子进程同步写 stdout 会在管道满时阻塞
  child.stdout.on('data', d => { stdoutTail = (stdoutTail + d.toString()).slice(-4000); });
  child.stderr.on('data', d => { stderrTail = (stderrTail + d.toString()).slice(-4000); });
  await waitHealthy(25000);
}, 40000);

afterAll(async () => {
  if (alive()) {
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); });
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test.each([
  ['浏览器/Electron 式报价', 'permessage-deflate; client_max_window_bits'],
  ['不带参数的报价（OkHttp 等）', 'permessage-deflate'],
])('%s：握手照常 101，但服务端不协商 permessage-deflate', async (_label, offer) => {
  const r = await wsHandshake(offer);
  if (r.status !== 101) console.error(tails());
  expect(r.status).toBe(101);
  expect(r.headers['sec-websocket-extensions']).toBeUndefined();
}, 15000);
