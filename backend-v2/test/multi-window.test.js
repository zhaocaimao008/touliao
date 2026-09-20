'use strict';
const http = require('http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const config = require('../src/config');
const setupRealtime = require('../src/realtime');

const isolated = req => req.set('X-Touliao-Session', 'isolated');
const noCookies = response => expect(response.headers['set-cookie']).toBeUndefined();
async function login(user, cookies, independent = true) {
  let req = request(app).post('/api/auth/login');
  if (cookies) req = req.set('Cookie', cookies);
  if (independent) req = isolated(req);
  const response = await req.send({ phone: user.phone, password: user.password, legalConsent: require('./legal-consent.cjs') });
  expect(response.status).toBe(200);
  return response;
}
const me = (token, cookies) => isolated(request(app).get('/api/auth/me'))
  .set('Authorization', `Bearer ${token}`).set('Cookie', cookies);

test('two isolated logins, refresh and logout preserve the normal browser session', async () => {
  const original = await makeUser();
  const accountA = await makeUser();
  const accountB = await makeUser();
  const normal = await login(original, null, false);
  const cookies = normal.headers['set-cookie'].map(value => value.split(';')[0]);
  const a = await login(accountA, cookies);
  const b = await login(accountB, cookies);
  noCookies(a); noCookies(b);
  expect(a.headers['x-touliao-session']).toBe('isolated');
  expect((await me(a.body.token, cookies)).body.id).toBe(accountA.userId);
  expect((await me(b.body.token, cookies)).body.id).toBe(accountB.userId);
  const refreshed = await isolated(request(app).post('/api/auth/refresh'))
    .set('Authorization', `Bearer ${a.body.token}`).set('Cookie', cookies);
  expect(refreshed.status).toBe(200); noCookies(refreshed);
  expect((await me(refreshed.body.token, cookies)).body.id).toBe(accountA.userId);
  const out = await isolated(request(app).post('/api/auth/logout'))
    .set('Authorization', `Bearer ${refreshed.body.token}`).set('Cookie', cookies);
  expect(out.status).toBe(200); noCookies(out);
  expect((await me(refreshed.body.token, cookies)).status).toBe(401);
  expect((await me(b.body.token, cookies)).body.id).toBe(accountB.userId);
  expect((await request(app).get('/api/auth/me').set('Cookie', cookies)).body.id).toBe(original.userId);
  const missing = await isolated(request(app).get('/api/auth/me')).set('Cookie', cookies);
  expect(missing.status).toBe(401); noCookies(missing);
});

test('isolated websocket handshake cannot inherit a different account from cookies', async () => {
  const a = await makeUser();
  const b = await makeUser();
  const server = http.createServer(app);
  const io = new Server(server, { transports: ['websocket'] });
  setupRealtime(io, app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const sockets = [];
  const url = `http://127.0.0.1:${server.address().port}`;
  const open = token => new Promise((resolve, reject) => {
    const s = connect(url, {
      transports: ['websocket'], reconnection: false, timeout: 1500,
      auth: { isolated: true, token }, extraHeaders: { Cookie: `${config.cookieName}=${a.token}` },
    });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
  try {
    const socket = await open(b.token);
    expect(io.sockets.sockets.get(socket.id).user.id).toBe(b.userId);
    await expect(open(undefined)).rejects.toThrow();
  } finally {
    sockets.forEach(socket => socket.close());
    await new Promise(resolve => io.close(resolve));
  }
});

test('media tickets override shared cookies and invalid explicit credentials fail closed', async () => {
  const owner = await makeUser();
  const peer = await makeUser();
  const outsider = await makeUser();
  await befriend(owner, peer);
  const conversation = await privateConversation(owner, peer);
  const uploaded = await request(app).post(`/api/messages/${conversation}/upload`)
    .set('Authorization', `Bearer ${owner.token}`)
    .attach('file', Buffer.from('independent attachment'), { filename: 'window.txt', contentType: 'text/plain' });
  expect(uploaded.status).toBe(200);
  const file = uploaded.body.file_url;
  const ticket = await isolated(request(app).get('/api/uploads/ticket').query({ file }))
    .set('Authorization', `Bearer ${owner.token}`).set('Cookie', `${config.cookieName}=${outsider.token}`);
  expect(ticket.status).toBe(200);
  const response = await request(app).get(ticket.body.url).set('Cookie', `${config.cookieName}=${outsider.token}`);
  expect(response.status).toBe(200);
  expect(response.text).toBe('independent attachment');
  expect((await request(app).get(file).query({ token: 'unavailable' })
    .set('Cookie', `${config.cookieName}=${owner.token}`)).status).toBe(401);
  expect((await request(app).get(file).set('Authorization', `Bearer ${outsider.token}`)
    .set('Cookie', `${config.cookieName}=${owner.token}`)).status).toBe(403);
});
