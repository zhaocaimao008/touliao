'use strict';
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const config = require('../src/config');
const { db } = require('../src/db/connection');
const admins = require('../src/modules/admin/admin.service');
const notifications = require('../src/modules/notifications/notifications.service');

const root = { admin: true, username: config.admin.username, adminId: 'env-root', role: 'superadmin' };
const cookie = identity => `${config.admin.cookieName}=${jwt.sign({ ...identity, csrf: 'launch-csrf' }, config.adminJwtSecret, { expiresIn: '1h' })}`;
const asUser = (method, url, user) => request(app)[method](url).set('Authorization', `Bearer ${user.token}`);
const asAdmin = (url, identity = root) => request(app).get(url).set('Cookie', cookie(identity));

describe('launch audit: authorization boundaries', () => {
  let a, b, outsider, messageId, avatarPath;
  const ackManager = {
    recordDelivery: jest.fn().mockResolvedValue(true),
    recordRead: jest.fn().mockResolvedValue(true),
    getMessageAckStatus: jest.fn().mockResolvedValue({ delivered: [] }),
  };
  const batchAckManager = {
    batchRecordDelivery: jest.fn().mockResolvedValue(1),
    batchRecordRead: jest.fn().mockResolvedValue(1),
    getStats: jest.fn().mockReturnValue({ users: ['private-user'] }),
    flushAll: jest.fn().mockResolvedValue([]),
  };
  const msgQueue = {
    getQueueStats: jest.fn().mockResolvedValue({ pending: 1 }),
    getDLQMessages: jest.fn().mockResolvedValue([{ content: 'private-message' }]),
  };
  const cacheWarmer = {
    warmAll: jest.fn().mockResolvedValue({ duration: 1 }),
    warmUserData: jest.fn().mockResolvedValue({}),
  };

  beforeAll(async () => {
    a = await makeUser();
    b = await makeUser();
    outsider = await makeUser();
    await befriend(a, b);
    const conv = await privateConversation(a, b);
    messageId = `launch-msg-${Date.now()}`;
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content) VALUES (?,?,?,?,?)')
      .run(messageId, conv, a.userId, 'text', 'private-message');
    avatarPath = path.join(config.uploadsRoot, 'avatars', 'launch-admin.txt');
    fs.mkdirSync(path.dirname(avatarPath), { recursive: true });
    fs.writeFileSync(avatarPath, 'admin resource');
    for (const [name, manager] of Object.entries({ ackManager, batchAckManager, msgQueue, cacheWarmer })) app.set(name, manager);
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(() => fs.rmSync(avatarPath, { force: true }));

  test('untrusted clients cannot inject an allowlisted IP through forwarded headers', async () => {
    const previous = config.admin.ipWhitelist;
    config.admin.ipWhitelist = ['198.51.100.7'];
    try {
      for (const url of ['/api/admin/me', '/api/admin/login', '/api/vxin-admin-login']) {
        const method = url.endsWith('/me') ? 'get' : 'post';
        const res = await request(app)[method](url)
          .set('X-Forwarded-For', '198.51.100.7, 203.0.113.8').send({});
        expect(res.status).toBe(403);
      }
    } finally { config.admin.ipWhitelist = previous; }
  });

  test.each(['disable', 'delete'])('existing admin sessions stop immediately after %s, including media', async action => {
    const created = await admins.createAdmin({ username: `launch_${action}`, password: 'passw0rd12345', role: 'admin' }, 'env-root');
    const identity = { admin: true, username: created.username, role: 'admin', adminId: created.id };
    expect((await asAdmin('/api/admin/me', identity)).status).toBe(200);
    expect((await asAdmin('/uploads/avatars/launch-admin.txt', identity)).status).toBe(200);
    if (action === 'disable') admins.setAdminDisabled(created.id, true, 'env-root');
    else admins.deleteAdmin(created.id, 'env-root');
    expect((await asAdmin('/api/admin/me', identity)).status).toBe(401);
    expect((await asAdmin('/uploads/avatars/launch-admin.txt', identity)).status).toBe(401);
  });

  test('current database role overrides an old superadmin JWT', async () => {
    const created = await admins.createAdmin({ username: 'launch_demote', password: 'passw0rd12345', role: 'superadmin' }, 'env-root');
    const identity = { admin: true, username: created.username, role: 'superadmin', adminId: created.id };
    db.prepare("UPDATE admin_users SET role='admin' WHERE id=?").run(created.id);
    const res = await request(app).post('/api/admin/admins').set('Cookie', cookie(identity))
      .send({ username: 'launch_forbidden', password: 'passw0rd12345', role: 'admin' });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT 1 FROM admin_users WHERE username=?').get('launch_forbidden')).toBeUndefined();
  });

  test('legacy root identity remains usable, anonymous admin claims do not', async () => {
    expect((await asAdmin('/api/admin/me', { admin: true, username: config.admin.username })).status).toBe(200);
    expect((await asAdmin('/api/admin/me', { admin: true })).status).toBe(401);
    expect((await asAdmin('/uploads/avatars/launch-admin.txt', { admin: true })).status).toBe(401);
  });

  test('a device token moves to the active account without removing other devices', () => {
    notifications.saveDeviceToken(a.userId, 'launch-shared-token', 'ios_apns');
    notifications.saveDeviceToken(a.userId, 'launch-other-device', 'android');
    notifications.saveDeviceToken(b.userId, 'launch-shared-token', 'ios_apns');
    notifications.saveDeviceToken(b.userId, 'launch-shared-token', 'ios_apns');
    expect(db.prepare('SELECT user_id FROM device_tokens WHERE token=?').all('launch-shared-token')).toEqual([{ user_id: b.userId }]);
    notifications.deleteDeviceToken(a.userId, 'launch-shared-token');
    expect(db.prepare('SELECT user_id FROM device_tokens WHERE token=?').get('launch-shared-token').user_id).toBe(b.userId);
    expect(db.prepare('SELECT user_id FROM device_tokens WHERE token=?').get('launch-other-device').user_id).toBe(a.userId);
  });

  test('a browser subscription moves to the active account atomically', () => {
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/launch-shared', keys: { auth: 'test', p256dh: 'test' } };
    notifications.webSubscribe(a.userId, subscription);
    notifications.webSubscribe(b.userId, subscription);
    notifications.webSubscribe(b.userId, subscription);
    expect(db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint=?').all(subscription.endpoint)).toEqual([{ user_id: b.userId }]);
    notifications.webUnsubscribe(a.userId, subscription.endpoint);
    expect(db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint=?').get(subscription.endpoint).user_id).toBe(b.userId);
    expect(() => notifications.webSubscribe('missing-user', subscription)).toThrow();
    expect(db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint=?').get(subscription.endpoint).user_id).toBe(b.userId);
  });

  test.each(['delivery', 'read'])('outsiders cannot forge %s acknowledgments', async kind => {
    const res = await asUser('post', `/api/reliability/ack/${kind}`, outsider).send({ messageId });
    expect(res.status).toBe(403);
    expect(ackManager.recordDelivery).not.toHaveBeenCalled();
    expect(ackManager.recordRead).not.toHaveBeenCalled();
    expect(db.prepare('SELECT 1 FROM message_reads WHERE message_id=? AND user_id=?').get(messageId, outsider.userId)).toBeUndefined();
  });

  test('outsiders cannot read message acknowledgment status', async () => {
    const res = await asUser('get', `/api/reliability/ack/status?messageId=${messageId}`, outsider);
    expect(res.status).toBe(403);
    expect(ackManager.getMessageAckStatus).not.toHaveBeenCalled();
  });

  test('members can acknowledge and read status normally', async () => {
    expect((await asUser('post', '/api/reliability/ack/read', b).send({ messageId })).status).toBe(200);
    expect((await asUser('get', `/api/reliability/ack/status?messageId=${messageId}`, b)).status).toBe(200);
    expect(db.prepare('SELECT 1 FROM message_reads WHERE message_id=? AND user_id=?').get(messageId, b.userId)).toBeTruthy();
  });

  test('batch ACK checks the entire batch before performing any writes', async () => {
    const res = await asUser('post', '/api/optimization/ack/batch', outsider).send({ deliveries: [messageId], reads: [messageId] });
    expect(res.status).toBe(403);
    expect(batchAckManager.batchRecordDelivery).not.toHaveBeenCalled();
    expect(batchAckManager.batchRecordRead).not.toHaveBeenCalled();
  });

  test.each([{ reads: 'not-an-array' }, { reads: Array(501).fill('id') }, { deliveries: [{}] }])('batch ACK rejects malformed or oversized inputs: %j', async body => {
    expect((await asUser('post', '/api/optimization/ack/batch', b).send(body)).status).toBe(400);
    expect(batchAckManager.batchRecordDelivery).not.toHaveBeenCalled();
  });

  test('member batch responses do not expose other users in global statistics', async () => {
    const res = await asUser('post', '/api/optimization/ack/batch', b).send({ reads: [messageId] });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('private-user');
  });

  test.each([
    ['get', '/api/reliability/dlq'],
    ['get', '/api/reliability/queue/stats'],
    ['post', '/api/optimization/ack/flush'],
    ['post', '/api/optimization/cache/warm'],
    ['get', '/api/optimization/stats'],
    ['get', '/api/metrics/vitals/recent'],
    ['get', '/api/monitoring/health'],
    ['get', '/api/monitoring/redis-stats'],
    ['get', '/api/monitoring/tracing-stats'],
    ['get', '/api/monitoring/query-stats'],
    ['post', '/api/monitoring/redis-clear'],
  ])('ordinary users cannot access operational data: %s %s', async (method, url) => {
    expect((await asUser(method, url, outsider).send({})).status).toBe(401);
  });

  test('administrators can still inspect the dead letter queue', async () => {
    expect((await asAdmin('/api/reliability/dlq')).status).toBe(200);
    expect(msgQueue.getDLQMessages).toHaveBeenCalled();
  });

  test('users cannot trigger cache work for other accounts', async () => {
    const res = await asUser('post', '/api/optimization/cache/warm-user', outsider).send({ userId: a.userId });
    expect(res.status).toBe(403);
    expect(cacheWarmer.warmUserData).not.toHaveBeenCalled();
    expect((await asUser('post', '/api/optimization/cache/warm-user', a).send({ userId: a.userId })).status).toBe(200);
  });

  test('admin logout waits for durable revocation and reports persistence failures', async () => {
    const credentials = cookie({ ...root, csrf: 'logout-test' });
    db.exec("CREATE TEMP TRIGGER launch_logout_fail BEFORE INSERT ON token_blacklist BEGIN SELECT RAISE(ABORT, 'synthetic durability failure'); END");
    try {
      expect((await request(app).post('/api/admin/logout').set('Cookie', credentials)).status).toBe(500);
    } finally { db.exec('DROP TRIGGER launch_logout_fail'); }
    expect((await request(app).post('/api/admin/logout').set('Cookie', credentials)).status).toBe(200);
    expect((await request(app).get('/api/admin/me').set('Cookie', credentials)).status).toBe(401);
  });

  test.each([{ phone: {} }, { phone: ['123456'] }, { password: {} }, { password: ['passw0rd123'] }])('login rejects malformed credentials: %j', async fields => {
    expect((await request(app).post('/api/auth/login').send({ phone: a.phone, password: a.password, ...fields })).status).toBe(400);
  });

  test.each([{ password: ['passw0rd123'] }, { inviteCode: ['123456'] }])('registration rejects malformed credentials: %j', async fields => {
    expect((await request(app).post('/api/auth/register').send({ username: 'launch_malformed', phone: '1234567890', password: 'passw0rd123', inviteCode: '123456', ...fields })).status).toBe(400);
  });

  test('administrator credentials must be strings', async () => {
    expect((await request(app).post('/api/admin/login').send({ username: {}, password: {} })).status).toBe(400);
  });
});
