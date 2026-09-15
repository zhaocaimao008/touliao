'use strict';
const { randomUUID, generateKeyPairSync } = require('crypto');
process.env.FIREBASE_PROJECT_ID = 'fixture';
process.env.FIREBASE_CLIENT_EMAIL = 'fixture@example.invalid';
process.env.FIREBASE_PRIVATE_KEY = 'fixture';
process.env.APNS_KEY_ID = 'fixture';
process.env.APNS_TEAM_ID = 'fixture';
const privateKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.APNS_P8 = privateKey;

jest.mock('firebase-admin', () => {
  const send = jest.fn().mockResolvedValue('fixture-message');
  const sendEachForMulticast = jest.fn().mockResolvedValue({ responses: [{ success: true }] });
  return { apps: [], credential: { cert: jest.fn() }, initializeApp: jest.fn(),
    messaging: () => ({ send, sendEachForMulticast }), __send: send, __batch: sendEachForMulticast };
});
jest.mock('../src/utils/getuiPush', () => ({
  isEnabled: () => false, pushCallToCid: jest.fn().mockResolvedValue({}),
}));
jest.mock('http2', () => {
  const { EventEmitter } = require('events');
  const mock = { ...jest.requireActual('http2'), requests: [], reply: () => ({ status: 200, body: '{}' }) };
  mock.connect = jest.fn(() => {
    const client = new EventEmitter();
    client.setTimeout = client.close = client.destroy = jest.fn();
    client.request = headers => {
      const req = new EventEmitter();
      req.setTimeout = req.setEncoding = req.close = jest.fn();
      req.end = body => {
        const record = { headers, payload: JSON.parse(body) };
        mock.requests.push(record);
        Promise.resolve().then(() => mock.reply(record)).then(reply => {
          req.emit('response', { ':status': reply.status });
          req.emit('data', reply.body); req.emit('end');
        });
      };
      return req;
    };
    return client;
  });
  return mock;
});

const { makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
const { saveDeviceToken } = require('../src/modules/notifications/notifications.service');
const { pushToUser, pushCallInvite } = require('../src/utils/push');
const ownership = require('../src/utils/devicePushOwnership');
const fcm = require('firebase-admin');
const apns = require('http2');
const getui = require('../src/utils/getuiPush');
let user;
function session() {
  const id = randomUUID();
  db.prepare('INSERT INTO auth_sessions(id,user_id) VALUES(?,?)').run(id, user.userId);
  return id;
}
function device(token, platform, sessionId) {
  saveDeviceToken(user.userId, token, platform, sessionId);
  return db.prepare('SELECT * FROM device_tokens WHERE token=?').get(token);
}
const message = { senderName: 'fixture', body: 'fixture', conversationId: 'conversation', recipientId: 'spoofed' };
beforeAll(async () => { user = await makeUser(); });
beforeEach(() => {
  db.prepare('DELETE FROM device_tokens WHERE user_id=?').run(user.userId);
  apns.requests.length = 0; apns.reply = () => ({ status: 200, body: '{}' });
  fcm.__send.mockClear(); fcm.__batch.mockClear(); getui.pushCallToCid.mockClear();
});

test('APNs on phone A cannot suppress FCM on phone B of the same account', async () => {
  const a = session(), b = session();
  device('apns-A', 'ios_apns', a); device('fcm-A', 'ios', a); device('fcm-B', 'ios', b);
  await pushToUser(user.userId, message);
  expect(apns.requests).toHaveLength(1);
  expect(fcm.__send.mock.calls.map(([value]) => value.token)).toEqual(['fcm-B']);
  expect(apns.requests[0].payload.recipientId).toBe(user.userId);
  expect(fcm.__send.mock.calls[0][0].data.recipientId).toBe(user.userId);
});

test('APNs failure falls back to its own session, without redirecting to another phone', async () => {
  const a = session(), b = session();
  device('apns-A', 'ios_apns', a); device('fcm-A', 'ios', a); device('fcm-B', 'ios', b);
  apns.reply = () => ({ status: 500, body: '{}' });
  await pushToUser(user.userId, message);
  expect(fcm.__send.mock.calls.map(([value]) => value.token).sort()).toEqual(['fcm-A', 'fcm-B']);
});

test('late APNs fallback skips a destination rebound to another session', async () => {
  const a = session(), b = session();
  device('apns-A', 'ios_apns', a); device('fcm-A', 'ios', a);
  apns.reply = () => { device('fcm-A', 'ios', b); return { status: 500, body: '{}' }; };
  await pushToUser(user.userId, message);
  expect(fcm.__send).not.toHaveBeenCalled();
});

test('late APNs invalid-token response cannot delete the new session registration', async () => {
  const a = session(), b = session();
  device('apns-A', 'ios_apns', a);
  apns.reply = () => { device('apns-A', 'ios_apns', b); return { status: 410, body: '{"reason":"Unregistered"}' }; };
  await pushToUser(user.userId, message);
  expect(db.prepare('SELECT session_id FROM device_tokens WHERE token=?').get('apns-A').session_id).toBe(b);
});

test('provider cleanup checks the complete ownership snapshot, including same-account session changes', () => {
  const a = session(), b = session();
  const old = device('fcm-A', 'android', a);
  expect(ownership.isCurrent(old)).toBe(true);
  device('fcm-A', 'android', b);
  expect(ownership.isCurrent(old)).toBe(false);
  expect(ownership.forget(old).changes).toBe(0);
  expect(ownership.forget(db.prepare('SELECT * FROM device_tokens WHERE token=?').get('fcm-A')).changes).toBe(1);
});

test('FCM phone A cannot suppress GeTui phone B calls, while same-session duplicates are suppressed', async () => {
  const a = session(), b = session();
  device('fcm-A', 'android', a); device('getui-A', 'getui', a); device('getui-B', 'getui', b);
  await pushCallInvite({ toUserId: user.userId, fromUserId: 'caller', callerName: 'fixture', callType: 'audio', callId: 'call' });
  expect(getui.pushCallToCid.mock.calls.map(([token]) => token)).toEqual(['getui-B']);
  expect(getui.pushCallToCid.mock.calls[0][1].recipientId).toBe(user.userId);
  expect(fcm.__send.mock.calls[0][0].data.recipientId).toBe(user.userId);
});

test('Android batching preserves the actual recipient through payload compression', async () => {
  device('fcm-A', 'android', session());
  await pushToUser(user.userId, message);
  expect(fcm.__batch.mock.calls[0][0].data.recipientId).toBe(user.userId);
});
