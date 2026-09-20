'use strict';
jest.mock('../src/utils/push', () => ({ pushNewMessage: () => Promise.resolve() }));
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const request = require('supertest');
const { app, makeUser } = require('./f02-inprocess-http.cjs');
const { db } = require('../src/db/connection');
const config = require('../src/config');
const { registerFile } = require('../src/utils/fileRegistry');
const realtime = require('../src/realtime');
const registerFileHandler = require('../src/realtime/handlers/file');
let server, io, base, owner, outsider;
const sockets = [];
const file = '/uploads/files/f02-live.txt';
beforeAll(async () => {
  [owner, outsider] = await Promise.all(['owner', 'outsider'].map(name => makeUser({ username: `f02-live-${name}` })));
  for (const [id, users] of [['f02-live-source', [owner]], ['f02-live-target', [owner, outsider]]]) {
    db.prepare('INSERT INTO conversations(id,type) VALUES (?,?)').run(id, 'group');
    for (const user of users) db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES (?,?)').run(id, user.userId);
  }
  fs.mkdirSync(path.join(config.uploadsRoot, 'files'), { recursive: true });
  fs.writeFileSync(path.join(config.uploadsRoot, 'files/f02-live.txt'), 'synthetic live file');
  registerFile({ path: file, ownerId: owner.userId, conversationId: 'f02-live-source', kind: 'files' });
  db.prepare('INSERT INTO messages(id,conversation_id,sender_id,type,file_url) VALUES (?,?,?,?,?)')
    .run('f02-live-original', 'f02-live-source', owner.userId, 'file', file);
  server = http.createServer(app); io = new Server(server);
  // Install the actual authentication middleware on real Socket.IO transport.
  realtime({ use: fn => io.use(fn), on() {} });
  require('../src/realtime/broadcaster').setIo(io);
  realtime._resetIpHandshake();
  io.on('connection', socket => registerFileHandler(io, socket));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  sockets.forEach(socket => socket.close());
  if (io) await new Promise(resolve => io.close(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await require('../src/db/writer').shutdown();
});
function connect(token) {
  const socket = client(base, { transports: ['websocket'], reconnection: false, auth: { token }, timeout: 1500 });
  sockets.push(socket);
  return new Promise((resolve, reject) => { socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject); });
}
test('real unauthenticated socket is rejected', async () => {
  await expect(connect(undefined)).rejects.toThrow(/未授权/);
});
test('real socket planting is denied and the private download stays denied', async () => {
  const socket = await connect(outsider.token);
  expect((await request(base).get(file).set('Authorization', `Bearer ${outsider.token}`)).status).toBe(403);
  const ack = await socket.timeout(2000).emitWithAck('send_file_message', { conversationId: 'f02-live-target', type: 'file', file_url: file });
  expect(ack.success).toBe(false);
  expect(db.prepare('SELECT * FROM file_registry_shares WHERE path=?').all(file)).toHaveLength(0);
  expect(db.prepare('SELECT * FROM messages WHERE conversation_id=?').all('f02-live-target')).toHaveLength(0);
  expect((await request(base).get(file).set('Authorization', `Bearer ${outsider.token}`)).status).toBe(403);
});
test('real owner socket commits one message and grant, then recipient can download', async () => {
  const socket = await connect(owner.token);
  const ack = await socket.timeout(2000).emitWithAck('send_file_message', { conversationId: 'f02-live-target', type: 'file', file_url: file });
  expect(ack.success).toBe(true);
  expect(db.prepare('SELECT * FROM file_registry_shares WHERE path=?').all(file)).toHaveLength(1);
  expect(db.prepare('SELECT * FROM messages WHERE conversation_id=?').all('f02-live-target')).toHaveLength(1);
  expect((await request(base).get(file).set('Authorization', `Bearer ${outsider.token}`)).text).toBe('synthetic live file');
});
