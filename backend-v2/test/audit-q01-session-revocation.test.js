'use strict';
// Catch reissuing authority from revoked sessions/wallets, including within one second.
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { io: connectClient } = require('socket.io-client');
const { app, request, makeUser } = require('./helpers');
const config = require('../src/config');
const { db } = require('../src/db/connection');
const admin = require('../src/modules/admin/admin.service');
const setupRealtime = require('../src/realtime');

let server, io, baseUrl;
const sockets = new Set();
const UA = 'Mozilla/5.0 (Linux; Android 14)';
const NEW_PASSWORD = 'q01NewPassword987';

function cookie(res, name) {
  // Browsers apply Set-Cookie headers in order; the last value is the stored credential.
  return (res.headers['set-cookie'] || []).filter(c => c.startsWith(`${name}=`)).at(-1)?.split(';')[0];
}
function tokenFrom(res) {
  return res.body.token || decodeURIComponent(cookie(res, config.cookieName)?.slice(config.cookieName.length + 1) || '');
}
async function login(account, ua = UA, wallet, password = account.password) {
  let req = request(app).post('/api/auth/login').set('User-Agent', ua);
  if (wallet) req = req.set('Cookie', wallet);
  const res = await req.send({ phone: account.phone, password });
  expect(res.status).toBe(200);
  return { token: tokenFrom(res), wallet: cookie(res, config.walletCookie) || wallet, ua };
}
const me = device => request(app).get('/api/auth/me').set('Authorization', `Bearer ${device.token}`);
const refresh = device => request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${device.token}`);
const switchAccount = (device, account) => request(app).post('/api/auth/switch')
  .set('User-Agent', device.ua).set('Cookie', device.wallet).send({ userId: account.userId });
const revoke = (owner, device) => request(app).delete(`/api/auth/sessions/${jwt.decode(device.token).jti}`)
  .set('Authorization', `Bearer ${owner.token}`);
const change = (device, account) => request(app).put('/api/auth/change-password')
  .set('Authorization', `Bearer ${device.token}`).set('Cookie', device.wallet).set('User-Agent', device.ua)
  .send({ oldPassword: account.password, newPassword: NEW_PASSWORD });

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = connectClient(baseUrl, { transports: ['websocket'], auth: { token }, reconnection: false, timeout: 1500 });
    sockets.add(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', error => { s.close(); reject(error); });
  });
}
function disconnectedOnEvent(s) {
  if (!s.connected) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => { s.off('disconnect', done); resolve(false); }, 1500);
    function done() { clearTimeout(timer); resolve(true); }
    s.once('disconnect', done);
    // A real handler would ACK invalid content if authorization allowed this event.
    s.emit('send_message', {}, () => { clearTimeout(timer); s.off('disconnect', done); resolve(false); });
  });
}

beforeAll(async () => {
  server = http.createServer(app);
  io = new Server(server, { transports: ['websocket'] });
  app.set('io', io);
  setupRealtime(io, app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(2100000000000);
  setupRealtime._resetIpHandshake();
});
afterEach(() => {
  for (const s of sockets) s.close();
  sockets.clear();
  jest.restoreAllMocks();
});
afterAll(async () => {
  await new Promise(resolve => io.close(resolve));
  await new Promise(resolve => server.close(resolve));
});

test('deleted session rejects both old API credentials and wallet recovery; password login restores access', async () => {
  const account = await makeUser();
  const owner = await login(account, 'Windows');
  const removed = await login(account);
  expect((await revoke(owner, removed)).status).toBe(200);
  expect((await me(removed)).status).toBe(401);
  expect((await switchAccount(removed, account)).status).toBe(403);
  expect((await me(await login(account, UA, removed.wallet))).status).toBe(200);
});

test('two equal User-Agents with distinct wallets have separate sessions and precise removal', async () => {
  const account = await makeUser();
  const current = await login(account);
  const other = await login(account);
  const list = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${current.token}`).set('User-Agent', UA);
  expect(list.status).toBe(200);
  expect(list.body.filter(s => s.current)).toHaveLength(1);
  expect(jwt.decode(current.token).jti === jwt.decode(other.token).jti).toBe(false);
  expect((await revoke(current, other)).status).toBe(200);
  expect((await me(current)).status).toBe(200);
  expect((await switchAccount(current, account)).status).toBe(200);
  expect((await me(other)).status).toBe(401);
  expect((await switchAccount(other, account)).status).toBe(403);
});

test('deleting all other devices preserves current authorization and rejects their same-second refresh and wallets', async () => {
  const account = await makeUser();
  const current = await login(account);
  const other = await login(account);
  const res = await request(app).delete('/api/auth/sessions').set('User-Agent', UA).set('Authorization', `Bearer ${current.token}`);
  expect(res.status).toBe(200);
  expect((await me(current)).status).toBe(200);
  expect((await switchAccount(current, account)).status).toBe(200);
  expect((await refresh(other)).status).toBe(401);
  expect((await switchAccount(other, account)).status).toBe(403);
});

test('same-second password change issues a revocable current session and rejects every old device grant', async () => {
  const account = await makeUser();
  const current = await login(account, 'Windows');
  const other = await login(account);
  const res = await change(current, account);
  expect(res.status).toBe(200);
  expect((await me({ token: tokenFrom(res) })).status).toBe(200);
  expect(Boolean(jwt.decode(tokenFrom(res)).jti)).toBe(true);
  expect((await me(current)).status).toBe(401);
  expect((await me(other)).status).toBe(401);
  expect((await refresh(other)).status).toBe(401);
  expect((await switchAccount(other, account)).status).toBe(403);
  expect((await switchAccount(current, account)).status).toBe(200);
  expect((await me(await login(account, UA, other.wallet, NEW_PASSWORD))).status).toBe(200);
});

test('administrator reset revokes same-second tokens, refresh and wallets; new password login works', async () => {
  const account = await makeUser();
  const device = await login(account);
  await admin.resetPassword(io, account.userId, NEW_PASSWORD);
  expect((await me(device)).status).toBe(401);
  expect((await refresh(device)).status).toBe(401);
  expect((await switchAccount(device, account)).status).toBe(403);
  expect((await me(await login(account, UA, device.wallet, NEW_PASSWORD))).status).toBe(200);
});

test('refresh retains the session grant, and later removal revokes its replacement token', async () => {
  const account = await makeUser();
  const owner = await login(account, 'Windows');
  const device = await login(account);
  const res = await refresh(device);
  expect(res.status).toBe(200);
  expect(Boolean(res.body.token)).toBe(true);
  const renewed = { ...device, token: tokenFrom(res) };
  expect((await me(renewed)).status).toBe(200);
  expect((await me(device)).status).toBe(401);
  expect((await switchAccount(device, account)).status).toBe(200);
  expect((await revoke(owner, renewed)).status).toBe(200);
  expect((await refresh(renewed)).status).toBe(401);
  expect((await switchAccount(device, account)).status).toBe(403);
});

test.each(['delete', 'password', 'allOthers', 'refresh'])('%s blocks established socket events and old-token new handshakes', async action => {
  const account = await makeUser();
  const owner = await login(account, 'Windows');
  const device = await login(account);
  const socket = await connect(device.token);
  let res;
  if (action === 'delete') res = await revoke(owner, device);
  if (action === 'password') res = await change(owner, account);
  if (action === 'allOthers') res = await request(app).delete('/api/auth/sessions').set('User-Agent', owner.ua).set('Authorization', `Bearer ${owner.token}`);
  if (action === 'refresh') res = await refresh(device);
  expect(res.status).toBe(200);
  expect(await disconnectedOnEvent(socket)).toBe(true);
  await expect(connect(device.token)).rejects.toBeInstanceOf(Error);
  const valid = await connect(action === 'refresh' || action === 'password' ? tokenFrom(res) : owner.token);
  expect(valid.connected).toBe(true);
});

test('a legacy wallet without a session binding requires password login but does not invalidate the existing JWT', async () => {
  const account = await makeUser();
  const wallet = 'vxin_wallet=q01-legacy-wallet';
  db.prepare('INSERT INTO device_accounts(wallet_id,user_id) VALUES (?,?)').run('q01-legacy-wallet', account.userId);
  expect((await me(account)).status).toBe(200);
  expect((await switchAccount({ wallet, ua: UA }, account)).status).toBe(403);
  const rebound = await login(account, UA, wallet);
  expect((await switchAccount(rebound, account)).status).toBe(200);
});

test('single-device removal revokes all unbound legacy JWTs without affecting a different bound session', async () => {
  const account = await makeUser();
  const current = await login(account, 'Windows');
  const other = await login(account);
  const legacy = { token: jwt.sign({ id: account.userId, username: account.username, csrf: 'q01-legacy-csrf' }, config.jwtSecret, { expiresIn: '1h' }) };
  expect((await me(legacy)).status).toBe(200);
  expect((await revoke(current, other)).status).toBe(200);
  expect((await me(legacy)).status).toBe(401);
  expect((await me(current)).status).toBe(200);
});

test('an older surviving session remains valid after all-other revocation', async () => {
  const account = await makeUser();
  const current = await login(account, 'Windows');
  const other = await login(account);
  Date.now.mockReturnValue(2100000005000);
  expect((await request(app).delete('/api/auth/sessions').set('Authorization', `Bearer ${current.token}`).set('User-Agent', current.ua)).status).toBe(200);
  expect((await me(current)).status).toBe(200);
  expect((await me(other)).status).toBe(401);
});

test.each(['delete', 'password', 'allOthers', 'refresh'])('%s disconnects a silent socket before future private broadcasts', async action => {
  const account = await makeUser();
  const current = await login(account, 'Windows');
  const other = await login(account);
  const socket = await connect(other.token);
  const disconnected = new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 1000);
    socket.once('disconnect', () => { clearTimeout(timer); resolve(true); });
  });
  if (action === 'delete') await revoke(current, other);
  if (action === 'password') await change(current, account);
  if (action === 'allOthers') await request(app).delete('/api/auth/sessions').set('User-Agent', current.ua).set('Authorization', `Bearer ${current.token}`);
  if (action === 'refresh') await refresh(other);
  expect(await disconnected).toBe(true);
  expect(io.sockets.sockets.size).toBe(0);
  expect((await me(action === 'password' ? await login(account, 'Windows', current.wallet, NEW_PASSWORD) : current)).status).toBe(200);
});

test('late rejection of an old session never clears the fresh change-password cookie', async () => {
  const account = await makeUser();
  const current = await login(account, 'Windows');
  const other = await login(account);
  const changed = await change(current, account);
  expect(changed.status).toBe(200);
  const late = await me(other);
  expect(late.status).toBe(401);
  expect(Boolean(cookie(late, config.cookieName))).toBe(false);
  expect((await request(app).get('/api/auth/me').set('Cookie', cookie(changed, config.cookieName))).status).toBe(200);
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('old-password login cannot create a session after an administrator reset during bcrypt comparison', async () => {
  const account = await makeUser();
  const entered = deferred(), release = deferred();
  const compare = bcrypt.compare;
  jest.spyOn(bcrypt, 'compare').mockImplementationOnce(async (...args) => {
    const matches = await compare(...args);
    entered.resolve();
    await release.promise;
    return matches;
  });
  const pending = request(app).post('/api/auth/login').send({ phone: account.phone, password: account.password }).then(res => res);
  await entered.promise;
  await admin.resetPassword(io, account.userId, NEW_PASSWORD);
  release.resolve();
  expect((await pending).status).toBe(400);
  expect((await me(await login(account, UA, undefined, NEW_PASSWORD))).status).toBe(200);
});

test('a password change awaiting bcrypt cannot restore a session that was removed meanwhile', async () => {
  const account = await makeUser();
  const current = await login(account, 'Windows');
  const other = await login(account);
  const entered = deferred(), release = deferred();
  const hash = bcrypt.hash;
  // bcryptjs's own compare() recomputes internally via hash(data, saltString, callback) —
  // callback-style, second arg is the salt (a string). Only the deliberate call we want to
  // delay, hash(newPassword, costFactor), passes a rounds NUMBER as the second arg; let the
  // compare()-internal call straight through or it eats this mock and never actually blocks.
  jest.spyOn(bcrypt, 'hash').mockImplementation((...args) => {
    if (typeof args[1] !== 'number') return hash(...args);
    return (async () => {
      const value = await hash(...args);
      entered.resolve();
      await release.promise;
      return value;
    })();
  });
  const pending = change(other, account).then(res => res);
  await entered.promise;
  const revokeRes = await revoke(current, other);
  expect(revokeRes.status).toBe(200);
  release.resolve();
  expect((await pending).status).toBe(401);
  expect((await me(await login(account, UA, other.wallet))).status).toBe(200);
});

test('removing another user session cannot blacklist or disconnect its owner', async () => {
  const owner = await makeUser();
  const other = await makeUser();
  expect((await revoke(owner, other)).status).toBe(200);
  expect((await me(other)).status).toBe(200);
});

test('single-device removal also revokes a refreshed legacy token from the same second', async () => {
  const account = await makeUser();
  const current = await login(account, 'Windows');
  const other = await login(account);
  const legacy = { token: jwt.sign({ id: account.userId, username: account.username, csrf: 'q01-refresh-csrf' }, config.jwtSecret, { expiresIn: '1h' }) };
  const res = await refresh(legacy);
  expect(res.status).toBe(200);
  expect((await revoke(current, other)).status).toBe(200);
  expect((await me({ token: tokenFrom(res) })).status).toBe(401);
});

test.each(['password', 'refresh'])('%s supplies a CSRF credential that permits the current browser next write', async action => {
  const account = await makeUser();
  const device = await login(account);
  const res = action === 'password' ? await change(device, account) : await refresh(device);
  expect(res.status).toBe(200);
  const disabled = process.env.DISABLE_CSRF;
  process.env.DISABLE_CSRF = '0';
  try {
    const saved = await request(app).put('/api/users/me/settings')
      .set('Cookie', [cookie(res, config.cookieName), cookie(res, config.csrfCookie)])
      .set('X-CSRF-Token', res.headers['x-csrf-token']).send({ lang: 'en' });
    expect(saved.status).toBe(200);
  } finally { process.env.DISABLE_CSRF = disabled; }
});
