'use strict';
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn().mockResolvedValue({}) }));
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const { app, request, makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
const notifications = require('../src/modules/notifications/notifications.service');
const auth = require('../src/modules/auth/auth.service');
const fcm = require('../src/utils/fcmOptimized');
const { pushToUser } = require('../src/utils/push');
const webpush = require('web-push');
const subscription = name => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: 'test-key', auth: 'test-auth' } });
let a, b;
beforeAll(async () => { a = await makeUser(); b = await makeUser(); });
function session(user) {
  const id = randomUUID();
  db.prepare('INSERT INTO auth_sessions(id,user_id) VALUES(?,?)').run(id, user.userId);
  return id;
}

test('authenticated subscription registration binds to its verified session, not client-supplied identity', async () => {
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${a.token}`);
  expect(me.body.sessionId).toBe(jwt.decode(a.token).jti);
  const sub = subscription(randomUUID());
  const res = await request(app).post('/api/notifications/web-subscribe').set('Authorization', `Bearer ${a.token}`)
    .send({ subscription: sub, sessionId: jwt.decode(b.token).jti });
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT user_id,session_id FROM push_subscriptions WHERE endpoint=?').get(sub.endpoint))
    .toEqual({ user_id: a.userId, session_id: jwt.decode(a.token).jti });
});

test('independent account subscriptions coexist and session revocation only removes its own devices', async () => {
  const sa = session(a), sb = session(b), other = session(a);
  const subA = subscription(randomUUID()), subB = subscription(randomUUID()), subOther = subscription(randomUUID());
  notifications.webSubscribe(a.userId, subA, sa);
  notifications.webSubscribe(b.userId, subB, sb);
  notifications.webSubscribe(a.userId, subOther, other);
  const tokenA = randomUUID(), tokenB = randomUUID();
  notifications.saveDeviceToken(a.userId, tokenA, 'android', sa);
  notifications.saveDeviceToken(b.userId, tokenB, 'android', sb);
  await auth.deleteSession(a.userId, sa);
  expect(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint=?').get(subA.endpoint)).toBeUndefined();
  expect(db.prepare('SELECT 1 FROM device_tokens WHERE token=?').get(tokenA)).toBeUndefined();
  for (const sub of [subB, subOther]) expect(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint=?').get(sub.endpoint)).toBeDefined();
  expect(db.prepare('SELECT 1 FROM device_tokens WHERE token=?').get(tokenB)).toBeDefined();
});

test('late unregister from an older session cannot remove the newer session ownership', () => {
  const old = session(a), current = session(a), sub = subscription(randomUUID()), token = randomUUID();
  notifications.webSubscribe(a.userId, sub, old);
  notifications.saveDeviceToken(a.userId, token, 'android', old);
  notifications.webSubscribe(a.userId, sub, current);
  notifications.saveDeviceToken(a.userId, token, 'android', current);
  notifications.webUnsubscribe(a.userId, sub.endpoint, old);
  notifications.deleteDeviceToken(a.userId, token, old);
  expect(db.prepare('SELECT session_id FROM push_subscriptions WHERE endpoint=?').get(sub.endpoint).session_id).toBe(current);
  expect(db.prepare('SELECT session_id FROM device_tokens WHERE token=?').get(token).session_id).toBe(current);
});

test('a deleted or other-account session cannot register tokens', () => {
  const other = session(b);
  expect(() => notifications.saveDeviceToken(a.userId, randomUUID(), 'android', other)).toThrow('登录会话');
  expect(() => notifications.webSubscribe(a.userId, subscription(randomUUID()), randomUUID())).toThrow('登录会话');
});

test('FCM lookup does not retain token ownership after account transfer or logout', async () => {
  const sa = session(a), sb = session(b), token = randomUUID();
  notifications.saveDeviceToken(a.userId, token, 'android', sa);
  expect((await fcm.getAndroidTokens(a.userId)).some(row => row.token === token)).toBe(true);
  notifications.saveDeviceToken(b.userId, token, 'android', sb);
  expect((await fcm.getAndroidTokens(a.userId)).some(row => row.token === token)).toBe(false);
  expect((await fcm.getAndroidTokens(b.userId)).some(row => row.token === token)).toBe(true);
  await auth.deleteSession(b.userId, sb);
  expect((await fcm.getAndroidTokens(b.userId)).some(row => row.token === token)).toBe(false);
});

test('web notification payload binds its actual recipient', async () => {
  notifications.webSubscribe(a.userId, subscription(randomUUID()), session(a));
  webpush.sendNotification.mockClear();
  await pushToUser(a.userId, { body: 'test', recipientId: b.userId });
  expect(webpush.sendNotification).toHaveBeenCalled();
  for (const [, payload] of webpush.sendNotification.mock.calls) expect(JSON.parse(payload).recipientId).toBe(a.userId);
});

test('logout cannot report success while session and push revocation failed to persist', async () => {
  const user = await makeUser();
  const id = jwt.decode(user.token).jti;
  const sub = subscription(randomUUID());
  notifications.webSubscribe(user.userId, sub, id);
  db.exec("CREATE TRIGGER fail_session_delete BEFORE DELETE ON auth_sessions BEGIN SELECT RAISE(ABORT, 'synthetic session delete failure'); END;");
  try {
    const failed = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${user.token}`);
    expect(failed.status).toBe(500);
    expect(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint=?').get(sub.endpoint)).toBeDefined();
  } finally { db.exec('DROP TRIGGER fail_session_delete'); }
  const retry = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${user.token}`);
  expect(retry.status).toBe(200);
  expect(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint=?').get(sub.endpoint)).toBeUndefined();
});

test('legacy unbound credentials cannot register or remove session-owned notifications', async () => {
  const user = await makeUser();
  const legacy = jwt.sign({ id: user.userId, csrf: randomUUID() }, require('../src/config').jwtSecret, { expiresIn: '1h' });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${legacy}`);
  expect(me.status).toBe(200);
  for (const [method, route] of [['post', 'web-subscribe'], ['delete', 'web-subscribe'], ['post', 'device-token'], ['delete', 'device-token']]) {
    const res = await request(app)[method](`/api/notifications/${route}`).set('Authorization', `Bearer ${legacy}`)
      .send({ subscription: subscription(randomUUID()), token: randomUUID(), platform: 'android' });
    expect(res.status).toBe(401);
  }
});

test('session ownership transactions reserve the SQLite writer before reading', async () => {
  const Database = require('better-sqlite3');
  const peer = new Database(db.name, { timeout: 0 });
  const id = session(a);
  const prepare = db.prepare.bind(db);
  let probes = 0;
  const spy = jest.spyOn(db, 'prepare').mockImplementation(sql => {
    const statement = prepare(sql);
    if (sql === 'SELECT 1 FROM auth_sessions WHERE id=? AND user_id=?') {
      return { get(...args) {
        const row = statement.get(...args);
        // A deferred transaction would let this connection invalidate its read snapshot.
        expect(() => peer.prepare('UPDATE users SET status=status WHERE id=?').run(a.userId)).toThrow(/locked/);
        probes++;
        return row;
      } };
    }
    return statement;
  });
  try {
    notifications.webSubscribe(a.userId, subscription(randomUUID()), id);
    notifications.saveDeviceToken(a.userId, randomUUID(), 'android', id);
    await auth.deleteSession(a.userId, id);
    expect(probes).toBe(3);
  } finally { spy.mockRestore(); peer.close(); }
});
