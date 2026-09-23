'use strict';
const http = require('http');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const { app, makeUser } = require('./helpers');
const setupRealtime = require('../src/realtime');
let io, origin, account;
const clients = new Set();
beforeAll(async () => {
  account = await makeUser();
  const server = http.createServer(app);
  io = new Server(server); app.set('io', io); setupRealtime(io, app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => setupRealtime._resetIpHandshake());
afterEach(() => { for (const socket of clients) socket.close(); clients.clear(); io.disconnectSockets(true); });
afterAll(async () => { await new Promise(resolve => io.close(resolve)); });
function connect(options) {
  const socket = client(origin, { reconnection: false, ...options }); clients.add(socket);
  return new Promise(resolve => {
    socket.once('connect', () => resolve({ socket, connected: true }));
    socket.once('connect_error', error => resolve({ socket, error }));
  });
}
test.each(['websocket', 'polling'])('F06 malformed cookie gets a controlled connect_error over %s and server remains usable', async transport => {
  for (const cookie of ['%', '%GG', '%E0%A4%A']) {
    const result = await connect({ transports: [transport], extraHeaders: { Cookie: `vxin_token=${cookie}` } });
    expect(result.error?.message).toBe('Token无效');
    expect(result.socket.connected).toBe(false);
    result.socket.close();
  }
  const valid = await connect({ transports: [transport], extraHeaders: { Cookie: `vxin_token=${encodeURIComponent(account.token)}` } });
  expect(valid.connected).toBe(true); expect(valid.error).toBeUndefined();
});
test('Bearer socket authentication still works', async () => {
  expect((await connect({ transports: ['websocket'], auth: { token: account.token } })).connected).toBe(true);
});
