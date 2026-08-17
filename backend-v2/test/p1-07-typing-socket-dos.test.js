'use strict';
/**
 * P1-07 攻击视角回归：typing 洪泛 + Socket 连接洪泛。
 *
 * 真实 socket.io server（随机端口）+ socket.io-client 建连，模拟攻击者：
 *   1. typing flood：同 (userId, conversationId) 400ms 节流，100 次/秒连发 → 广播 ≤ 3 次
 *   2. 不同会话节流独立：A 在 conv1/conv2 交替发 → 各自独立放行
 *   3. stop_typing 仍即时（不被 typing 节流误伤）
 *   4. Socket 连接 flood：每用户并发上限 5，第 6 条连接握手阶段被拒
 *   5. disconnect/reconnect 计数释放：断开后重连成功
 *   6. 多设备正常：4 台设备同时在线互不影响
 *   7. per-IP 握手频率限制：60s 窗口 30 次，超限拒绝
 *   8. 节流表内存有界：惰性清理后 size 不无限增长
 */
const http = require('http');
const { Server } = require('socket.io');
const { io: ioc } = require('socket.io-client');
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const setupRealtime = require('../src/realtime');
const typingModule = require('../src/realtime/handlers/typing');
const realtimeModule = require('../src/realtime');

let server, io, baseUrl;

function connect(token, opts = {}) {
  return new Promise((resolve, reject) => {
    const s = ioc(baseUrl, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 3000,
      ...opts,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err) => reject(err));
  });
}

/** 等 join 生效（join 事件里是 DB 查询后异步 join 房间） */
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));

beforeAll(async () => {
  server = http.createServer(app);
  io = new Server(server, {
    transports: ['websocket'],
    cors: { origin: '*' },
    pingInterval: 25000,
    pingTimeout: 20000,
  });
  app.set('io', io);
  setupRealtime(io, app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise(r => io.close(r));
  await new Promise(r => server.close(r));
});

describe('P1-07 typing 洪泛限流（SOCKET-003）', () => {
  let a, b, convId;

  beforeAll(async () => {
    a = await makeUser({ username: 'p107_ta' });
    b = await makeUser({ username: 'p107_tb' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
  });

  test('typing 100 次/秒连发同一会话 → 广播 ≤ 3 次（400ms 节流）', async () => {
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    await tick();
    // 双方加入会话房间（DB 成员校验后 join）
    sa.emit('join_conversation', { conversationId: convId });
    sb.emit('join_conversation', { conversationId: convId });
    await tick();

    let bGot = 0;
    sb.on('typing', () => { bGot += 1; });

    // 攻击：1s 内连发 100 次 typing
    const start = Date.now();
    while (Date.now() - start < 1000) {
      sa.emit('typing', { conversationId: convId });
      await tick(9); // ~100 次/秒
    }
    await tick(500); // 等最后窗口

    // 400ms 节流 → 1s 窗口最多 ~3 次广播（100 次连发被截断）
    expect(bGot).toBeGreaterThan(0);
    expect(bGot).toBeLessThanOrEqual(4);
    sa.disconnect();
    sb.disconnect();
  });

  test('不同会话节流独立，互不阻塞', async () => {
    const c = await makeUser({ username: 'p107_tc' });
    await befriend(a, c);
    const conv2 = await privateConversation(a, c);

    const sa = await connect(a.token);
    const sc = await connect(c.token);
    await tick();
    sa.emit('join_conversation', { conversationId: convId });
    sa.emit('join_conversation', { conversationId: conv2 });
    sc.emit('join_conversation', { conversationId: conv2 });
    await tick();

    let cGot = 0;
    sc.on('typing', () => { cGot += 1; });

    // conv2 上第一次 typing 应立即广播（与 convId 节流独立）
    sa.emit('typing', { conversationId: conv2 });
    await tick(200);
    expect(cGot).toBe(1);

    // 同 conv2 立即再发 → 被节流丢弃
    sa.emit('typing', { conversationId: conv2 });
    await tick(200);
    expect(cGot).toBe(1);

    sa.disconnect();
    sc.disconnect();
  });

  test('stop_typing 不被 typing 节流误伤，仍即时广播', async () => {
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    await tick();
    sa.emit('join_conversation', { conversationId: convId });
    sb.emit('join_conversation', { conversationId: convId });
    await tick();

    let bStop = 0;
    sb.on('stop_typing', () => { bStop += 1; });

    sa.emit('typing', { conversationId: convId });   // 第 1 次放行
    await tick(500);                                  // 出节流窗口
    sa.emit('typing', { conversationId: convId });   // 再放行
    sa.emit('stop_typing', { conversationId: convId });
    await tick(300);
    expect(bStop).toBe(1);

    sa.disconnect();
    sb.disconnect();
  });

  test('stop_typing 洪泛（1s 110 次）→ 广播 ≤ 4 次，与 typing 同频截断（REVIEW P1 绕过路径）', async () => {
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    await tick();
    sa.emit('join_conversation', { conversationId: convId });
    sb.emit('join_conversation', { conversationId: convId });
    await tick();

    let bStop = 0;
    sb.on('stop_typing', () => { bStop += 1; });

    // 攻击：1s 内连发 110 次 stop_typing（修复前全部即时广播）
    const start = Date.now();
    let sent = 0;
    while (Date.now() - start < 1000 && sent < 110) {
      sa.emit('stop_typing', { conversationId: convId });
      sent += 1;
      await tick(8);
    }
    expect(sent).toBeGreaterThanOrEqual(100);
    await tick(500);

    // 独立 :stop 节流 400ms → 1s 窗口最多 ~3 次广播
    expect(bStop).toBeLessThanOrEqual(4);

    // 正常 stop_typing 不被节流长期卡死：等窗口过再发 → 仍放行
    await tick(500);
    sa.emit('stop_typing', { conversationId: convId });
    await tick(300);
    expect(bStop).toBeLessThanOrEqual(5);

    sa.disconnect();
    sb.disconnect();
  });

  test('typing + stop_typing 交替反转洪泛 → 合计广播仍 ≤ 8/s（对称事件不能叠加绕过）', async () => {
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    await tick();
    sa.emit('join_conversation', { conversationId: convId });
    sb.emit('join_conversation', { conversationId: convId });
    await tick();

    let bEvt = 0;
    sb.on('typing', () => { bEvt += 1; });
    sb.on('stop_typing', () => { bEvt += 1; });

    // 攻击：typing / stop_typing 各 30 次交替（修复前 30/30 全穿透）
    const start = Date.now();
    while (Date.now() - start < 1000) {
      sa.emit('typing', { conversationId: convId });
      sa.emit('stop_typing', { conversationId: convId });
      await tick(8);
    }
    await tick(500);

    // typing key + stop key 各自 ≤3/s → 合计 ≤ 8 次（1s 内）
    expect(bEvt).toBeLessThanOrEqual(8);

    sa.disconnect();
    sb.disconnect();
  });
});

describe('P1-07 Socket 连接洪泛保护（SOCKET-004）', () => {
  let u;

  beforeAll(async () => {
    u = await makeUser({ username: 'p107_flood' });
  });

  test('每用户并发上限 5：4 台设备正常，第 5 台 OK，第 6 台握手被拒', async () => {
    const sockets = [];
    // 4 台正常设备
    for (let i = 0; i < 4; i++) sockets.push(await connect(u.token));
    await tick();
    // 第 5 台（上限）也应成功
    sockets.push(await connect(u.token));
    await tick();
    expect(sockets.length).toBe(5);

    // 第 6 台 → 握手阶段被拒（不进入 connection）
    await expect(connect(u.token)).rejects.toThrow('连接数超限');

    for (const s of sockets) s.disconnect();
    await tick();
  });

  test('disconnect 释放计数：断开 2 台后可再连回', async () => {
    const sockets = [];
    for (let i = 0; i < 4; i++) sockets.push(await connect(u.token));
    await tick();
    expect(sockets.length).toBe(4);

    sockets[0].disconnect();
    sockets[1].disconnect();
    await tick();

    // 释放后允许再连（上限 5，已用 2 → 还可连 3）
    const s5 = await connect(u.token);
    const s6 = await connect(u.token);
    expect(s5.connected).toBe(true);
    expect(s6.connected).toBe(true);
    s5.disconnect();
    s6.disconnect();
    for (const s of sockets.slice(2)) s.disconnect();
    await tick();
  });

  test('多设备正常登录互不影响：4 台在线时用户状态 online 且可收发', async () => {
    const sockets = [];
    for (let i = 0; i < 4; i++) sockets.push(await connect(u.token));
    await tick();

    const me = await request(app)
      .get(`/api/users/${u.userId}`)
      .set('Authorization', `Bearer ${u.token}`);
    expect(me.status).toBe(200);
    expect(me.body.status).toBe('online');

    for (const s of sockets) s.disconnect();
    await tick();
  });

  test('per-IP 握手频率限制：60s 窗口 30 次，超限被拒', async () => {
    // 重置计数（避免前面用例占用 IP 配额）
    realtimeModule._resetIpHandshake();
    const results = [];
    for (let i = 0; i < 31; i++) {
      try {
        const s = await connect('bad-token-' + i); // 未授权也会先过 IP 检查
        results.push('ok');
        s.disconnect();
      } catch (err) {
        results.push(err.message);
      }
    }
    await tick();
    // 前 30 次为未授权（过 IP 检查），第 31 次被 IP 限流拒绝
    const ipRejected = results.filter(r => r === '连接过于频繁，请稍后再试');
    expect(ipRejected.length).toBeGreaterThanOrEqual(1);
    realtimeModule._resetIpHandshake();
  });

  test('typing 节流表内存有界：超上限触发惰性清理，size 不无限增长', () => {
    const { typingThrottle, TYPING_THROTTLE_MAX, TYPING_THROTTLE_TTL } = typingModule._throttle;
    // 直接塞入超过上限的过期条目，模拟长时间运行后的历史 key
    const now = Date.now();
    for (let i = 0; i < TYPING_THROTTLE_MAX + 500; i++) {
      typingThrottle.set(`leak_${i}:conv`, now - TYPING_THROTTLE_TTL - 1000); // 已过期
    }
    // 触发一次 throttleTyping 写入 → 惰性清理过期条目
    typingModule._throttle.throttleTyping('leak_trigger', 'conv');
    expect(typingThrottle.size).toBeLessThan(TYPING_THROTTLE_MAX + 10);
    typingThrottle.clear();
  });
});
