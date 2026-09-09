'use strict';
// Real HTTP/SQLite/upload bytes: revoked credentials must lose media access too.
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: connectClient } = require('socket.io-client');
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const config = require('../src/config');
const { db } = require('../src/db/connection');
const { addToBlacklist } = require('../src/utils/tokenBlacklist');
const admin = require('../src/modules/admin/admin.service');
const setupRealtime = require('../src/realtime');
const { logger } = require('../src/utils/logger');

const BYTES = 'Q02 synthetic private attachment\n';
const PASSWORD = 'q02ReplacementPassword987';
let peer, outsider, server, io, baseUrl;
beforeAll(async () => {
  logger.silent = true;
  peer = await makeUser();
  outsider = await makeUser();
  server = http.createServer(app);
  io = new Server(server, { transports: ['websocket'] });
  app.set('io', io);
  setupRealtime(io, app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise(resolve => io.close(resolve));
  await new Promise(resolve => server.close(resolve));
  logger.silent = false;
});

async function login(account, password = account.password) {
  const res = await request(app).post('/api/auth/login').set('User-Agent', 'Android Q02')
    .send({ phone: account.phone, password });
  expect(res.status).toBe(200);
  return res.body.token;
}
async function fixture(group = false) {
  const account = await makeUser();
  const token = await login(account);
  await befriend(account, peer);
  let convId;
  if (group) {
    const created = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${peer.token}`).send({ name: 'Q02 group', memberIds: [account.userId] });
    expect(created.status).toBe(200);
    convId = created.body.conversationId;
  } else {
    convId = await privateConversation(account, peer);
  }
  const up = await request(app).post(`/api/messages/${convId}/upload`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from(BYTES), { filename: 'q02.txt', contentType: 'text/plain' });
  expect(up.status).toBe(200);
  const file = up.body.file_url;
  expect((await getFile(file, token)).text).toBe(BYTES);
  return { account, token, convId, file };
}
function getFile(file, token, transport = 'bearer') {
  const req = request(app).get(file);
  if (transport === 'cookie') return req.set('Cookie', `${config.cookieName}=${token}`);
  if (transport === 'query') return req.query({ token });
  return req.set('Authorization', `Bearer ${token}`);
}
async function ticket(file, token) {
  const res = await request(app).get('/api/uploads/ticket').query({ file }).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(typeof res.body.url).toBe('string');
  return res.body.url;
}
async function revoke(f, action) {
  if (action === 'delete') {
    const res = await request(app).delete(`/api/auth/sessions/${jwt.decode(f.token).jti}`)
      .set('Authorization', `Bearer ${f.account.token}`);
    expect(res.status).toBe(200);
  } else if (action === 'password') {
    const res = await request(app).put('/api/auth/change-password').set('Authorization', `Bearer ${f.account.token}`)
      .send({ oldPassword: f.account.password, newPassword: PASSWORD });
    expect(res.status).toBe(200);
  } else if (action === 'ban') {
    admin.setBanned(io, f.account.userId, true);
  } else if (action === 'refresh') {
    const res = await request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${f.token}`);
    expect(res.status).toBe(200);
  } else if (action === 'logout') {
    expect((await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${f.token}`)).status).toBe(200);
  } else if (action === 'durable-delete') {
    db.prepare('DELETE FROM auth_sessions WHERE id=? AND user_id=?').run(jwt.decode(f.token).jti, f.account.userId);
  }
}

test.each(['delete', 'password', 'ban', 'durable-delete'])('%s denies API and ordinary attachment credentials over cookie, bearer and query', async action => {
  const f = await fixture();
  await revoke(f, action);
  const expected = action === 'ban' ? 403 : 401;
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${f.token}`)).status).toBe(expected);
  for (const transport of ['cookie', 'bearer', 'query']) {
    expect((await getFile(f.file, f.token, transport)).status).toBe(expected);
  }
  expect((await request(app).get('/api/uploads/ticket').query({ file: f.file }).set('Authorization', `Bearer ${f.token}`)).status).toBe(expected);
  if (action === 'ban') admin.setBanned(io, f.account.userId, false);
  const fresh = await login(f.account, action === 'password' ? PASSWORD : f.account.password);
  expect((await getFile(f.file, fresh)).text).toBe(BYTES);
  expect((await getFile(f.file, peer.token)).text).toBe(BYTES);
  expect((await getFile(f.file, outsider.token)).status).toBe(403);
});

test.each(['delete', 'password', 'ban', 'refresh', 'logout', 'durable-delete'])('%s also invalidates an already-issued resource ticket', async action => {
  const f = await fixture();
  const url = await ticket(f.file, f.token);
  expect((await request(app).get(url)).text).toBe(BYTES);
  await revoke(f, action);
  expect((await request(app).get(url)).status).toBe(action === 'ban' ? 403 : 401);
  if (action === 'ban') admin.setBanned(io, f.account.userId, false);
  const fresh = await login(f.account, action === 'password' ? PASSWORD : f.account.password);
  expect((await request(app).get(await ticket(f.file, fresh))).text).toBe(BYTES);
});

test('resource ticket rechecks membership after issuer leaves its conversation', async () => {
  const f = await fixture(true);
  const url = await ticket(f.file, f.token);
  expect((await request(app).get(url)).text).toBe(BYTES);
  expect((await request(app).post(`/api/messages/conversation/${f.convId}/leave`)
    .set('Authorization', `Bearer ${f.token}`)).status).toBe(200);
  expect((await getFile(f.file, f.token)).status).toBe(403);
  expect((await request(app).get(url)).status).toBe(403);
  expect((await getFile(f.file, peer.token)).text).toBe(BYTES);
});

test('resource ticket rechecks a recalled attachment reference', async () => {
  const f = await fixture();
  const url = await ticket(f.file, f.token);
  db.prepare('UPDATE messages SET deleted=2 WHERE conversation_id=? AND file_url=?').run(f.convId, f.file);
  expect((await getFile(f.file, f.token)).status).toBe(403);
  expect((await request(app).get(url)).status).toBe(403);
});

test('legacy unbound ticket fails closed and authenticated issuer can regenerate', async () => {
  const f = await fixture();
  const legacy = jwt.sign({ file: f.file }, config.jwtSecret, { expiresIn: 600 });
  expect((await getFile(f.file, legacy, 'query')).status).toBe(401);
  expect((await request(app).get(await ticket(f.file, f.token))).text).toBe(BYTES);
});

test('ticket stays on one path and cannot authenticate API, refresh, ticket minting or socket', async () => {
  const f = await fixture();
  const url = await ticket(f.file, f.token);
  const token = new URL(url, 'http://local').searchParams.get('token');
  expect((await getFile('/uploads/avatars/other.txt', token, 'query')).status).toBe(401);
  for (const route of ['/api/auth/me', '/api/uploads/ticket?file=' + encodeURIComponent(f.file)]) {
    expect((await request(app).get(route).set('Authorization', `Bearer ${token}`)).status).toBe(401);
  }
  expect((await request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  setupRealtime._resetIpHandshake();
  const denied = await new Promise(resolve => {
    const socket = connectClient(baseUrl, { transports: ['websocket'], auth: { token }, reconnection: false, timeout: 1500 });
    socket.once('connect', () => { socket.close(); resolve(false); });
    socket.once('connect_error', () => { socket.close(); resolve(true); });
  });
  expect(denied).toBe(true);
});

test('legacy user credential and derived ticket respect original password-change watermark', async () => {
  const f = await fixture();
  const iat = Math.floor(Date.now() / 1000) - 10;
  const legacy = jwt.sign({ id: f.account.userId, csrf: 'q02-legacy', iat }, config.jwtSecret, { expiresIn: 300 });
  const url = await ticket(f.file, legacy);
  db.prepare('UPDATE users SET password_changed_at=? WHERE id=?').run(iat, f.account.userId);
  expect((await getFile(f.file, legacy)).status).toBe(401);
  expect((await request(app).get(url)).status).toBe(401);
  expect((await getFile(f.file, f.token)).text).toBe(BYTES);
});

test('ticket lifetime cannot outlast its issuing user credential', async () => {
  const f = await fixture();
  const payload = jwt.decode(f.token);
  const token = jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) + 30 }, config.jwtSecret);
  const url = await ticket(f.file, token);
  const expires = jwt.decode(new URL(url, 'http://local').searchParams.get('token')).exp;
  expect(expires <= jwt.decode(token).exp).toBe(true);
});

test('administrator access requires admin claim and rejects blacklisted credentials', async () => {
  const f = await fixture();
  const adminToken = jwt.sign({ admin: true, csrf: 'q02-admin' }, config.adminJwtSecret, { expiresIn: 600 });
  expect((await request(app).get(f.file).set('Cookie', `${config.admin.cookieName}=${adminToken}`)).text).toBe(BYTES);
  expect((await getFile(f.file, adminToken)).text).toBe(BYTES);
  const nonAdmin = jwt.sign({ csrf: 'q02-no-admin' }, config.adminJwtSecret, { expiresIn: 600 });
  expect((await getFile(f.file, nonAdmin)).status).toBe(401);
  await addToBlacklist(adminToken, jwt.decode(adminToken).exp);
  expect((await getFile(f.file, adminToken)).status).toBe(401);
});

test('development shared-secret configuration still distinguishes administrator claims from ordinary users', async () => {
  const f = await fixture();
  const original = config.adminJwtSecret;
  config.adminJwtSecret = config.jwtSecret;
  try {
    const token = jwt.sign({ admin: true, csrf: 'q02-dev-admin' }, config.adminJwtSecret, { expiresIn: 600 });
    expect((await getFile(f.file, token)).text).toBe(BYTES);
    expect((await getFile(f.file, outsider.token)).status).toBe(403);
  } finally { config.adminJwtSecret = original; }
});

test.each(['refresh', 'logout'])('%s cannot report success when durable credential revocation fails', async action => {
  const f = await fixture();
  await ticket(f.file, f.token);
  db.exec("CREATE TEMP TRIGGER q02_http_revoke_fail BEFORE INSERT ON token_blacklist WHEN NEW.token LIKE 'credential:%' BEGIN SELECT RAISE(ABORT, 'synthetic durability failure'); END");
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = await request(app).post(`/api/auth/${action}`).set('Authorization', `Bearer ${f.token}`);
    expect(res.status).toBe(500);
    expect(Boolean(res.body.token)).toBe(false);
    expect((res.headers['set-cookie'] || []).some(c => c.startsWith(`${config.cookieName}=`))).toBe(false);
  } finally {
    db.exec('DROP TRIGGER q02_http_revoke_fail');
    log.mockRestore();
  }
});
