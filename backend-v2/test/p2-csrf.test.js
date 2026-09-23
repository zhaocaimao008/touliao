'use strict';
const { app, request, makeUser } = require('./helpers');
const config = require('../src/config');
const { db } = require('../src/db/connection');
let account, other, previous;
const authCookie = () => `${config.cookieName}=${account.token}`;
const write = () => request(app).put('/api/users/me/settings').send({ momentsVisibleDays: 3 });
beforeAll(async () => { account = await makeUser(); other = await makeUser(); });
beforeEach(() => { previous = process.env.DISABLE_CSRF; process.env.DISABLE_CSRF = '0'; });
afterEach(() => { process.env.DISABLE_CSRF = previous; });

test.each([
  ['both missing', '', null],
  ['header missing', '; csrf_token=pair', null],
  ['cookie missing', '', 'pair'],
  ['mismatch', '; csrf_token=pair', 'wrong'],
])('F07 rejects Cookie-authenticated writes with %s', async (_name, extra, header) => {
  const before = db.prepare('SELECT moments_visible_days FROM user_settings WHERE user_id=?').get(account.userId);
  const req = write().set('Cookie', authCookie() + extra);
  if (header) req.set('X-CSRF-Token', header);
  const res = await req;
  expect(res.status).toBe(403); expect(res.body.error).toMatch(/CSRF/);
  expect(db.prepare('SELECT moments_visible_days FROM user_settings WHERE user_id=?').get(account.userId)).toEqual(before);
});
test('preserves matching double-submit semantics (not newly bound to JWT csrf claim)', async () => {
  const res = await write().set('Cookie', `${authCookie()}; csrf_token=matching-pair`).set('X-CSRF-Token', 'matching-pair');
  expect(res.status).toBe(200);
});
test.each(['Bearer bogus', 'Basic ignored', 'Bearer '])('auth Cookie plus %s cannot bypass CSRF', async header => {
  expect((await write().set('Cookie', authCookie()).set('Authorization', header)).status).toBe(403);
});
test('auth Cookie plus another valid Bearer still requires proof for the selected Cookie session', async () => {
  db.prepare('UPDATE user_settings SET moments_visible_days=1 WHERE user_id=?').run(account.userId);
  const otherBefore = db.prepare('SELECT moments_visible_days FROM user_settings WHERE user_id=?').get(other.userId);
  expect((await write().set('Cookie', authCookie()).set('Authorization', `Bearer ${other.token}`)).status).toBe(403);
  const res = await write().set('Cookie', `${authCookie()}; csrf_token=pair`).set('X-CSRF-Token', 'pair')
    .set('Authorization', `Bearer ${other.token}`);
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT moments_visible_days AS days FROM user_settings WHERE user_id=?').get(account.userId).days).toBe(3);
  expect(db.prepare('SELECT moments_visible_days FROM user_settings WHERE user_id=?').get(other.userId)).toEqual(otherBefore);
});
test('pure Bearer remains usable with stale CSRF cookie', async () => {
  expect((await write().set('Authorization', `Bearer ${account.token}`).set('Cookie', 'csrf_token=stale')).status).toBe(200);
});
test('isolated clients ignore shared cookies before CSRF and auth', async () => {
  const res = await write().set('X-Touliao-Session', 'isolated').set('Cookie', `${authCookie()}; csrf_token=stale`)
    .set('Authorization', `Bearer ${other.token}`);
  expect(res.status).toBe(200); expect(res.headers['x-touliao-session']).toBe('isolated');
  expect(res.headers['set-cookie']).toBeUndefined();
});
test('missing credentials reaches normal 401 auth rejection', async () => {
  expect((await write()).status).toBe(401);
});
test('safe GET restores CSRF proof and the next write succeeds', async () => {
  const res = await request(app).get('/api/auth/me').set('Cookie', authCookie());
  expect(res.status).toBe(200); expect(res.headers['x-csrf-token']).toBeTruthy();
  const csrf = res.headers['set-cookie'].find(c => c.startsWith(config.csrfCookie + '=')).split(';')[0];
  expect((await write().set('Cookie', `${authCookie()}; ${csrf}`).set('X-CSRF-Token', res.headers['x-csrf-token'])).status).toBe(200);
});
test('login exemption remains usable with stale cookies', async () => {
  const res = await request(app).post('/api/auth/login').set('Cookie', `${authCookie()}; csrf_token=stale`)
    .send({ phone: account.phone, password: account.password, legalConsent: require('./legal-consent.cjs') });
  expect(res.status).toBe(200);
});
test.each(['post', 'patch', 'delete'])('Cookie writes using %s also require proof', async method => {
  const res = await request(app)[method]('/api/moments').set('Cookie', authCookie()).send({ content: 'blocked' });
  expect(res.status).toBe(403); expect(res.body.error).toMatch(/CSRF/);
});
