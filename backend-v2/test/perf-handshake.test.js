'use strict';
/**
 * 2026-10-11 perf-handshake 回归：per-IP / 全局握手限流命中后，客户端必须「稍后自动重试」，不能永久停摆。
 *
 * 旧实现在 io.use 里 next(new Error('连接过于频繁，请稍后再试')) 拒绝 → 命名空间级 CONNECT_ERROR，
 * socket.io-client v4 收到即 socket.destroy()（socket.active === false，Manager 不再重连），
 * 各端 connect_error 处理又只认鉴权类文案 → 前台窗口一直离线直到切 tab / 重启。
 * 新实现把限流挂到 engine.io allowRequest：拒绝是 HTTP 层失败（transport error），socket 保持 active，
 * Manager 按退避继续重连；窗口滚动（这里用 _resetIpHandshake 模拟 60s 过去）后自动连上。
 *
 * 真实 socket.io server（随机端口）+ socket.io-client 建连（对齐 core-ws-auth / p1-07 既有范例）。
 */
const http = require('http');
const { Server } = require('socket.io');
const { io: ioc } = require('socket.io-client');
const { app, makeUser } = require('./helpers');
const setupRealtime = require('../src/realtime');

let server, io, baseUrl;
let priorDenied = 0;
// 假 io（对齐 f01-proxy-handshake.test.js 的截获方式）+ 假 engine：直接驱动 allowRequest 与 io.use 中间件，
// 模拟「同一条 engine 连接（同一个 req）上反复发 CONNECT」。必须先于真实 io 调 setupRealtime，
// 让 broadcaster 最终绑定到真实 io。
const fakeEngine = { opts: {} };
const fakeMiddleware = [];

function within(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}（${ms}ms 内未发生）`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

beforeAll(async () => {
  setupRealtime({ engine: fakeEngine, use: fn => fakeMiddleware.push(fn), on() {} });
  server = http.createServer(app);
  io = new Server(server, {
    transports: ['websocket'],
    cors: { origin: '*' },
    pingInterval: 25000,
    pingTimeout: 20000,
    // 既有 allowRequest 必须被串联保留且先执行：被它拒掉的请求不应消耗握手限流配额
    allowRequest: (req, cb) => {
      if (req.headers['x-test-deny'] === '1') { priorDenied += 1; return cb('denied by prior allowRequest', false); }
      cb(null, true);
    },
  });
  app.set('io', io);
  setupRealtime(io, app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  setupRealtime._resetIpHandshake();
  await new Promise(r => io.close(r));
  await new Promise(r => server.close(r));
});

describe('perf-handshake：握手限流拒绝可被客户端自动重试', () => {
  test('超出 per-IP 限额：transport 层拒绝、socket 仍 active 并按退避重连，窗口滚动后自动连上且只计一次', async () => {
    const u = await makeUser({ username: 'perf_hs_retry' });
    const ip = '192.0.2.77';
    setupRealtime._resetIpHandshake();
    // 同一出口 IP 在当前窗口内已用满 30 次（重启后的重连潮 / 共享 NAT 场景）
    for (let i = 0; i < 30; i++) expect(setupRealtime.checkIpHandshake(ip)).toBe(true);

    const s = ioc(baseUrl, {
      transports: ['websocket'],
      auth: { token: u.token },
      // 服务端看到的 TCP peer 是 127.0.0.1（回环可信）→ 按 X-Real-IP 计配额，与线上 nginx 部署一致
      extraHeaders: { 'x-real-ip': ip },
      reconnection: true,          // 与线上客户端一致：依赖 Manager 自动重连
      reconnectionDelay: 50,
      reconnectionDelayMax: 100,
      randomizationFactor: 0,
      timeout: 2000,
    });
    try {
      const errors = [];
      let attempts = 0;
      s.io.on('reconnect_attempt', () => { attempts += 1; });
      const twoErrors = new Promise(resolve => {
        s.on('connect_error', err => {
          // active 必须在事件当下取：CONNECT_ERROR 路径会先 destroy() 再 emit，此时已是 false
          errors.push({ message: err.message, type: err.type, active: s.active });
          if (errors.length === 2) resolve();
        });
      });
      await within(twoErrors, 3000, '限流期间应连续收到两次 connect_error（首连 + 一次自动重连）');

      for (const e of errors) {
        expect(e.type).toBe('TransportError');               // HTTP 层失败，不是命名空间 CONNECT_ERROR
        expect(e.message).not.toMatch(/连接过于频繁|服务繁忙/);
        expect(e.active).toBe(true);                          // 仍会自动重连（旧实现这里是 false）
      }
      expect(attempts).toBeGreaterThanOrEqual(1);             // 第二次失败来自 Manager 的自动重连
      expect(s.connected).toBe(false);

      // 窗口滚动（等价于 60s 过去）→ 下一次退避重连自动成功，不需要切 tab / 网络变化等外部事件
      const connected = new Promise(resolve => s.once('connect', resolve));
      setupRealtime._resetIpHandshake();
      await within(connected, 3000, '限流解除后应自动重连成功');
      expect(s.connected).toBe(true);

      // 放行的握手只计一次（engine 层计数后 io.use 不重复计数）：本窗口还剩 29 次，第 30 次被拒
      for (let i = 0; i < 29; i++) expect(setupRealtime.checkIpHandshake(ip)).toBe(true);
      expect(setupRealtime.checkIpHandshake(ip)).toBe(false);
    } finally {
      s.close();
      setupRealtime._resetIpHandshake();
    }
  });

  test('allowRequest：第 31 次以 success=false 拒绝（engine 回 HTTP 4xx）；既有 allowRequest 先执行且其拒绝不耗配额', async () => {
    setupRealtime._resetIpHandshake();
    expect(typeof io.engine.opts.allowRequest).toBe('function');
    const allow = headers => new Promise(resolve => io.engine.opts.allowRequest(
      { socket: { remoteAddress: '127.0.0.1' }, headers },
      (message, success) => resolve({ message, success }),
    ));
    const ip = '192.0.2.88';

    // 被既有 allowRequest 拒掉的 50 次：原样返回它的拒绝，且不消耗该 IP 的 30 次配额
    const deniedBefore = priorDenied;
    for (let i = 0; i < 50; i++) {
      expect(await allow({ 'x-real-ip': ip, 'x-test-deny': '1' })).toEqual({ message: 'denied by prior allowRequest', success: false });
    }
    expect(priorDenied - deniedBefore).toBe(50);

    for (let i = 0; i < 30; i++) expect(await allow({ 'x-real-ip': ip })).toEqual({ message: null, success: true });
    const denied = await allow({ 'x-real-ip': ip });
    expect(denied.success).toBe(false);
    expect(denied.message).toMatch(/连接过于频繁/);
    // 其它 IP 的配额互不影响
    expect((await allow({ 'x-real-ip': '192.0.2.89' })).success).toBe(true);
    setupRealtime._resetIpHandshake();
  });

  test('engine 放行标记只抵扣一次：同一 engine 连接上反复 CONNECT，从第二次起照旧计入 per-IP 配额', async () => {
    setupRealtime._resetIpHandshake();
    expect(typeof fakeEngine.opts.allowRequest).toBe('function');
    const ip = '192.0.2.99';
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': ip } };
    // engine 层放行：计 1 次，并给这条连接的 req 打标
    expect(await new Promise(resolve => fakeEngine.opts.allowRequest(req, (message, success) => resolve(success)))).toBe(true);
    // 同一条 engine 连接上的 CONNECT：socket.request 指向同一个 req；无 token → 过了限流就是「未授权」
    const connectOnSameConn = () => new Promise(resolve => fakeMiddleware[0](
      { request: req, handshake: { address: '127.0.0.1', headers: req.headers, auth: {} } },
      err => resolve(err ? err.message : 'ok'),
    ));
    // 第 1 次 CONNECT 抵扣 engine 已计的那 1 次；第 2..30 次计数 2..30；合计仍是每窗口 30 次
    for (let i = 0; i < 30; i++) expect(await connectOnSameConn()).toBe('未授权');
    expect(await connectOnSameConn()).toMatch(/连接过于频繁/);
    setupRealtime._resetIpHandshake();
  });
});
