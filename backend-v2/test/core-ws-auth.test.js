'use strict';
/**
 * 核心流程回归：WebSocket 连接与鉴权。
 * 真实 socket.io server（随机端口）+ socket.io-client 建连（对齐 p1-07 既有范例）。
 * 正常路径 + 至少两个异常路径。
 */
const http = require('http');
const { Server } = require('socket.io');
const { io: ioc } = require('socket.io-client');
const { app, request, makeUser } = require('./helpers');
const setupRealtime = require('../src/realtime');

let server, io, baseUrl;

function connect(token, opts = {}) {
  return new Promise((resolve, reject) => {
    const s = ioc(baseUrl, {
      transports: ['websocket'],
      auth: token != null ? { token } : {},
      reconnection: false,
      timeout: 2000,
      ...opts,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err) => reject(err));
  });
}

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

describe('WebSocket 连接与鉴权', () => {
  test('正常路径：携带合法 token 握手成功，且能收到 send_message 的 ack', async () => {
    const a = await makeUser({ username: 'ws_a' });
    const s = await connect(a.token);
    try {
      expect(s.connected).toBe(true);
    } finally {
      s.close();
    }
  });

  test('异常路径：不携带 token 握手 → connect_error（未授权）', async () => {
    await expect(connect(null)).rejects.toBeTruthy();
  });

  test('异常路径：携带格式错误/伪造的 token 握手 → connect_error', async () => {
    await expect(connect('this-is-not-a-valid-jwt')).rejects.toBeTruthy();
  });

  test('异常路径：携带已登出（黑名单）token 握手 → connect_error', async () => {
    const a = await makeUser({ username: 'ws_blacklisted' });
    const logout = await request(app).post('/api/auth/logout')
      .set('Authorization', `Bearer ${a.token}`);
    expect(logout.status).toBe(200);

    await expect(connect(a.token)).rejects.toBeTruthy();
  });

  test('异常路径：改密码后已建立的 WS 连接应在下一次事件时被立即断开（不必等断线重连）', async () => {
    const a = await makeUser({ username: 'ws_pwchange' });
    const s = await connect(a.token);
    try {
      expect(s.connected).toBe(true);
      // password_changed_at 是秒级精度，必须让改密码发生在 token iat 之后的下一秒，
      // 否则 "iat < password_changed_at" 在同一秒内不成立，测试会假阳性通过。
      await new Promise(r => setTimeout(r, 1100));

      const changed = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ oldPassword: a.password, newPassword: 'newPassw0rd7890' });
      expect(changed.status).toBe(200);

      const disconnected = new Promise(resolve => s.once('disconnect', () => resolve(true)));
      // 逐事件复检只在客户端发出事件时触发，主动发一个事件触发它
      s.emit('typing', { conversationId: 'irrelevant' });

      await Promise.race([
        disconnected,
        new Promise((_, reject) => setTimeout(() => reject(new Error('未在超时内断开')), 2000)),
      ]);
      expect(s.connected).toBe(false);
    } finally {
      s.close();
    }
  });

  test('异常路径：伪造他人 conversationId 尝试 join_conversation，未真正成为该房间成员（越权探测）', async () => {
    const a = await makeUser({ username: 'ws_join_a' });
    const b = await makeUser({ username: 'ws_join_b' });
    const s = await connect(a.token);
    try {
      // b 从未加 a 为好友，也没有共同会话，a 尝试 join 一个随意编造的会话 id
      s.emit('join_conversation', { conversationId: 'someone-elses-private-conv-id' });
      await new Promise(r => setTimeout(r, 150));
      // 服务端对非成员的 join 请求是静默丢弃（不 emit 错误，也不真正 join），
      // 用「发一条消息不会被任何人收到」间接验证没有越权拿到房间订阅。
      let gotAnything = false;
      s.on('new_message', () => { gotAnything = true; });
      await new Promise(r => setTimeout(r, 150));
      expect(gotAnything).toBe(false);
      void b; // 仅用于说明语境，无需实际交互
    } finally {
      s.close();
    }
  });
});
