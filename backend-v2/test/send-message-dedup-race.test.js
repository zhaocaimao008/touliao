'use strict';
/**
 * 弱网重发竞态（2026-09-26 生产日志：dbWorker UNIQUE constraint failed:
 * messages.sender_id, messages.client_msg_id）。
 *
 * 同一 clientMsgId 的两次 send_message 几乎同时到达时，两者都会在对方落库前通过
 * checkDedup，后写入的一方撞唯一约束。修复前它回 { success:false }，客户端显示
 * 「发送失败」，而消息其实已经发出；用户手动重发还可能产生重复消息。
 * 修复后应回 success 并带回已落库的同一条消息。
 *
 * 注意：不设 FORCE_SYNC_WRITES —— 同步写会让第一次请求在第二次开始前就落库，复现不出竞态。
 */
const http = require('http');
const { io: Client } = require('socket.io-client');
const { Server } = require('socket.io');
const { app, makeUser, befriend, privateConversation } = require('./helpers');
const setupRealtime = require('../src/realtime');
const { db } = require('../src/db/connection');
const config = require('../src/config');

let server, port;
const sockets = [];

beforeAll(async () => {
  server = http.createServer(app);
  const io = new Server(server, { transports: ['websocket'] });
  app.set('io', io);
  setupRealtime(io, app);
  await new Promise(r => server.listen(0, r));
  port = server.address().port;
});

afterAll(async () => {
  for (const s of sockets) { try { s.disconnect(); } catch {} }
  await new Promise(r => server.close(r));
});

function connect(token) {
  const s = Client(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false, auth: { token } });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', e => reject(new Error('socket 连接失败: ' + e.message)));
    setTimeout(() => reject(new Error('socket 连接超时')), 5000);
  });
}

const send = (s, payload) => new Promise(resolve => s.emit('send_message', payload, resolve));

jest.setTimeout(20000);

test('同一 clientMsgId 并发重发：两次都回成功、同一条消息、只落库一次', async () => {
  const a = await makeUser({ username: 'dedup_race_a' });
  const b = await makeUser({ username: 'dedup_race_b' });
  await befriend(a, b);
  const conversationId = await privateConversation(a, b);
  const s = await connect(a.token);

  const results = [];
  // 多轮并发，确保至少有一轮两次请求都在落库前通过去重检查；
  // 每轮间隔一个限流窗口，避免被逐用户 send_message 限流误伤
  for (let round = 0; round < 3; round += 1) {
    if (round) await new Promise(r => setTimeout(r, config.limits.msgRateWindow + 50));
    const clientMsgId = `race-${Date.now()}-${round}`;
    const payload = { conversationId, content: `弱网重发 ${round}`, clientMsgId };
    const [first, second] = await Promise.all([send(s, payload), send(s, payload)]);
    results.push({ clientMsgId, first, second });
  }

  for (const { clientMsgId, first, second } of results) {
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id=? AND client_msg_id=?').get(a.userId, clientMsgId);
    expect(rows.n).toBe(1);
  }
});
