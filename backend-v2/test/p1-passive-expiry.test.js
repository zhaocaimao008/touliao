'use strict';
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const setupRealtime = require('../src/realtime');
const config = require('../src/config');

let server, io, origin;
const clients = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(token) {
  const socket = client(origin, { transports: ['websocket'], auth: { token }, reconnection: false });
  clients.add(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
function signed(token, expiresIn) {
  const payload = jwt.decode(token);
  delete payload.iat;
  delete payload.exp;
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}
beforeAll(async () => {
  server = http.createServer(app);
  io = new Server(server, { transports: ['websocket'], pingInterval: 500, pingTimeout: 1500 });
  app.set('io', io);
  setupRealtime(io, app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => setupRealtime._resetIpHandshake());
afterEach(async () => {
  for (const socket of clients) socket.close();
  clients.clear();
  io.disconnectSockets(true);
  await new Promise(resolve => setImmediate(resolve));
  jest.restoreAllMocks();
});
afterAll(async () => { await new Promise(resolve => io.close(resolve)); });

test('HTTP and a receive-only socket both lose access at JWT expiry', async () => {
  const sender = await makeUser(), receiver = await makeUser();
  await befriend(sender, receiver);
  const conversation = await privateConversation(sender, receiver);
  const token = signed(receiver.token, 2);
  const socket = await connect(token);
  const received = [], expired = [], disconnected = [];
  socket.on('new_message', message => received.push(message));
  socket.on('new_message_batch', messages => received.push(...messages));
  socket.on('session_expired', event => expired.push(event));
  socket.on('disconnect', reason => disconnected.push(reason));
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  // No client application event is emitted during this wait (including room joins).
  await delay(jwt.decode(token).exp * 1000 - Date.now() + 150);
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  expect(socket.connected).toBe(false);
  expect(disconnected).toEqual(['io server disconnect']);
  expect(expired).toEqual([{ reason: 'Token已过期，请重新登录' }]);
  expect(io.sockets.sockets.size).toBe(0);
  const send = await request(app).post(`/api/messages/${conversation}`)
    .set('Authorization', `Bearer ${sender.token}`).send({ type: 'text', content: 'after passive expiry' });
  expect(send.status).toBe(200);
  await delay(180);
  expect(received.some(message => message.content === 'after passive expiry')).toBe(false);
});

test('long-lived JWT does not overflow the timer; disconnect clears the scheduled expiry', async () => {
  const account = await makeUser();
  const timers = jest.spyOn(global, 'setTimeout');
  const clear = jest.spyOn(global, 'clearTimeout');
  const socket = await connect(signed(account.token, '40d'));
  const index = timers.mock.calls.findIndex(([, ms]) => ms === 2 ** 31 - 1);
  expect(index).toBeGreaterThanOrEqual(0);
  const expiryTimer = timers.mock.results[index].value;
  await delay(50);
  expect(socket.connected).toBe(true);
  const serverSocket = io.sockets.sockets.get(socket.id);
  serverSocket.disconnect(true);
  expect(clear).toHaveBeenCalledWith(expiryTimer);
});
