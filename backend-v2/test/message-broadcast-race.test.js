'use strict';
/**
 * 真实事故复现（用户反馈：发送方撤回/删除了，接收方还是能看到消息）。
 *
 * new_message 走 broadcaster.js 的批量合并窗口（BATCH_WINDOW_MS，默认 5ms），
 * 队列里存的是发送那一刻的快照；而 message_recall/message_vanished 是立即单发，
 * 不经过这个队列。如果撤回/彻底删除发生在消息还没被批处理冲刷出去之前——
 * 接收方会先收到"已撤回"（此时消息还没进本地列表，是空操作），批处理窗口
 * 稍后才把发送时刻的原始内容当 new_message 发出去，而且此后再无事件把它移除。
 *
 * 修复：撤回/彻底删除路径广播前调用 broadcaster.purgeQueuedMessage()，
 * 把还没冲刷的快照原地摘掉。
 */
process.env.FORCE_SYNC_WRITES = '1';

const http = require('http');
const { io: Client } = require('socket.io-client');
const { Server } = require('socket.io');
const { app, makeUser, befriend, privateConversation } = require('./helpers');
const setupRealtime = require('../src/realtime');
const msgSvc = require('../src/modules/messages/messages.service');
const broadcaster = require('../src/realtime/broadcaster');
const { db } = require('../src/db/connection');
const { v4: uuidv4 } = require('uuid');

let server, port, sockets = [];

beforeAll(async () => {
  server = http.createServer(app);
  const io = new Server(server, { transports: ['websocket'], maxHttpBufferSize: 512 * 1024 });
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
  const s = Client(`http://127.0.0.1:${port}`, {
    transports: ['websocket'], reconnection: false,
    extraHeaders: { Cookie: `vxin_token=${token}` },
  });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', e => reject(new Error('socket 连接失败: ' + e.message)));
    setTimeout(() => reject(new Error('socket 连接超时')), 5000);
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

function insertMsg(convId, senderId, content = 'hello') {
  const id = uuidv4();
  db.prepare(
    'INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)'
  ).run(id, convId, senderId, 'text', content, Math.floor(Date.now() / 1000));
  return id;
}

test('撤回紧跟发送：批处理冲刷时不应带原始内容触发 new_message', async () => {
  const a = await makeUser({ username: 'race_recall_a' });
  const b = await makeUser({ username: 'race_recall_b' });
  await befriend(a, b);
  const convId = await privateConversation(a, b);

  const sb = await connect(b.token);
  await wait(200); // 等会话房间 join 完成

  const received = { newMessage: null };
  sb.on('new_message', (m) => { received.newMessage = m; });

  const msgId = insertMsg(convId, a.userId, '今晚8点见，走这个');
  // 模拟 send_message handler 里的那一行：入队但还没冲刷
  broadcaster.broadcastMessage(convId, {
    id: msgId, conversation_id: convId, sender_id: a.userId, type: 'text',
    content: '今晚8点见，走这个', deleted: 0, created_at: Math.floor(Date.now() / 1000),
  });
  // 紧跟着撤回（无额外延时）
  await msgSvc.remove(app.get('io'), a.userId, msgId, true, false, false);

  await wait(300); // 等批处理窗口冲刷 + 网络送达
  expect(received.newMessage).toBeNull();
});

test('彻底删除(vanish)紧跟发送：批处理冲刷时不应带原始内容触发 new_message', async () => {
  const a = await makeUser({ username: 'race_vanish_a' });
  const b = await makeUser({ username: 'race_vanish_b' });
  await befriend(a, b);
  const convId = await privateConversation(a, b);

  const sb = await connect(b.token);
  await wait(200);

  const received = { newMessage: null };
  sb.on('new_message', (m) => { received.newMessage = m; });

  const msgId = insertMsg(convId, a.userId, '这条要彻底删除');
  broadcaster.broadcastMessage(convId, {
    id: msgId, conversation_id: convId, sender_id: a.userId, type: 'text',
    content: '这条要彻底删除', deleted: 0, created_at: Math.floor(Date.now() / 1000),
  });
  await msgSvc.remove(app.get('io'), a.userId, msgId, false, true, false);

  await wait(300);
  expect(received.newMessage).toBeNull();
});
