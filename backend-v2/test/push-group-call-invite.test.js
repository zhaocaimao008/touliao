'use strict';
/**
 * 群通话邀请推送（utils/push.js pushGroupCallInvite + utils/getuiPush.js pushGroupCallInviteToCid）。
 *
 * 背景：群邀请此前只走 socket；Android 退到后台约 60 秒、socket 被省电策略断开后收不到。
 * 现在 group_call:start 成功后给群成员的 Android 设备补发推送（FCM data-only / 个推）。
 *
 * 本文件钉死的契约：
 *  1. 只发 android(FCM) 与 getui(个推)；ios / ios_apns / ios_voip / Web 订阅零发送。
 *  2. FCM：data-only、12 个字符串键、没有保留键 from、android.priority=high、0 < ttl ≤ 60000，
 *     能通过 firebase-admin 的 validateMessage。
 *  3. 个推：透传恰好 12 个字符串键；request_id 32 位且幂等；ttl ∈ [1000, 60000]；
 *     厂商通道 intent 带 S.conversationId / S.groupCall*，绝不带 S.callId / S.callFrom（旧版会当成 1v1 来电）。
 *  4. 同一登录会话同时有 android + getui 时只发 FCM（防同一台设备弹两次）。
 *  5. 跳过发起人、对本群免打扰的成员、忙线成员；邀请已过期时整次不发。
 *  6. 文案按被邀请人语言；失效令牌被清理；各种发送失败都被吞掉、只记日志。
 *
 * mock 写法沿用 push-call-getui.test.js：个推走 https（捕获请求体），FCM 走 firebase-admin。
 */

// ── 必须在 require push.js 之前设 env（getuiPush / push 模块顶部读 env 固定）────
process.env.GETUI_APP_ID = 'test-app-id';
process.env.GETUI_APP_KEY = 'test-app-key';
process.env.GETUI_MASTER_SECRET = 'test-master-secret';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test.com';
process.env.FIREBASE_PRIVATE_KEY = 'test-key';

const { randomUUID } = require('crypto');

// 捕获个推 HTTP 请求体（/auth + /push/single/cid）
const mockGetuiRequests = [];
let mockExpiredAuthOnce = false;   // 下一次 push 回 10001（个推 auth token 过期）
let mockGetuiPushCode = 0;         // push 的业务码（非 0 模拟 cid 过期等业务失败）
// 捕获 FCM 完整消息
const mockFcmMessages = [];

jest.mock('https', () => {
  const { Readable } = require('stream');
  const real = jest.requireActual('https');
  return {
    ...real,
    request: (url, options, cb) => {
      const urlStr = typeof url === 'string' ? url : url.href;
      const isPush = urlStr.includes('/push/single/cid');
      const fakeRes = new Readable({ read() {} });
      fakeRes.statusCode = 200;
      let reply = { code: 0, data: { token: 'gt-token' } };
      if (isPush && mockExpiredAuthOnce) { mockExpiredAuthOnce = false; reply = { code: 10001, msg: 'token invalid' }; }
      else if (isPush && mockGetuiPushCode) reply = { code: mockGetuiPushCode, msg: 'target user is invalid' };
      const body = JSON.stringify(reply);
      process.nextTick(() => {
        fakeRes.push(Buffer.from(body));
        fakeRes.push(null);
      });
      const req = {
        on: () => req,
        write: (chunk) => { mockGetuiRequests.push({ url: urlStr, body: JSON.parse(chunk.toString()) }); },
        end: () => {},
        destroy: () => {},
        setTimeout: () => req,
        close: () => {},
      };
      cb(fakeRes);
      return req;
    },
  };
});

jest.mock('firebase-admin', () => {
  const send = jest.fn((msg) => { mockFcmMessages.push(msg); return Promise.resolve('fcm-id'); });
  return {
    apps: [],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn(() => ({ projectId: 'p', clientEmail: 'e', privateKey: 'k' })) },
    messaging: () => ({ send }),
    __send: send,
  };
});

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(() => Promise.resolve()),
}));

const { pushGroupCallInvite } = require('../src/utils/push');
const getuiPush = require('../src/utils/getuiPush');
const { db } = require('../src/db/connection');
const { notificationId } = require('../src/utils/notificationPresentation');
const firebaseAdmin = require('firebase-admin');
const webpush = require('web-push');
const { makeUser } = require('./helpers');

const FCM_KEYS = ['type', 'recipientId', 'callId', 'conversationId', 'callType', 'fromId', 'fromName',
  'groupName', 'expiresAt', 'senderName', 'body', 'messageId'].sort();
const GETUI_KEYS = ['title', 'body', 'type', 'recipientId', 'callId', 'conversationId', 'callType', 'fromId',
  'fromName', 'groupName', 'expiresAt', 'messageId'].sort();
const FROM_NAME = '发起人小王';
const RUN = `gci-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const tok = name => `${RUN}-${name}`;   // device_tokens.token 全库唯一，按本次运行加前缀

const pushReqs = () => mockGetuiRequests.filter(r => r.url.includes('/push/single/cid')).map(r => r.body);

function insertToken(userId, platform, name, sessionId) {
  const sid = sessionId || db.prepare('SELECT id FROM auth_sessions WHERE user_id=? LIMIT 1').get(userId).id;
  db.prepare('INSERT OR REPLACE INTO device_tokens (id, user_id, token, platform, session_id) VALUES (?,?,?,?,?)')
    .run(tok(`id-${name}`), userId, tok(name), platform, sid);
}

function newSession(userId) {
  const id = randomUUID();
  db.prepare('INSERT INTO auth_sessions (id, user_id) VALUES (?, ?)').run(id, userId);
  return id;
}

function makeGroup(name, users) {
  const id = randomUUID();
  db.prepare("INSERT INTO conversations (id, type, name) VALUES (?, 'group', ?)").run(id, name);
  for (const u of users) db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(id, u.userId);
  return id;
}

describe('群通话邀请推送（pushGroupCallInvite）', () => {
  let starter, alice, bob, carol, users, convId, unnamedConvId;
  let warnSpy;

  const invite = (over = {}) => pushGroupCallInvite({
    callId: 'gci-call',
    conversationId: convId,
    callType: 'audio',
    fromUserId: starter.userId,
    fromName: FROM_NAME,
    expiresAt: Date.now() + 60000,
    isBusy: () => false,
    ...over,
  });

  beforeAll(async () => {
    starter = await makeUser();
    alice = await makeUser();
    bob = await makeUser();
    carol = await makeUser();
    users = [starter, alice, bob, carol];
    convId = makeGroup('测试群', users);
    unnamedConvId = makeGroup('', [starter, alice]);
  });

  // 各测试文件共用同一个测试库：本文件造的令牌 / 订阅 / 会话设置每个用例前后都清掉
  function cleanupFixtures() {
    if (!users) return;
    const ids = users.map(u => u.userId);
    const ph = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM device_tokens WHERE user_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM push_subscriptions WHERE user_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM conversation_settings WHERE user_id IN (${ph})`).run(...ids);
    db.prepare(`UPDATE user_settings SET lang='zh-CN' WHERE user_id IN (${ph})`).run(...ids);
  }

  afterAll(() => cleanupFixtures());

  beforeEach(() => {
    cleanupFixtures();
    mockGetuiRequests.length = 0;
    mockFcmMessages.length = 0;
    mockExpiredAuthOnce = false;
    mockGetuiPushCode = 0;
    firebaseAdmin.__send.mockClear();
    webpush.sendNotification.mockClear();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warnSpy.mockRestore());

  test('仅 android 令牌：只发一条 data-only FCM，载荷与契约逐字一致并通过 validateMessage', async () => {
    insertToken(alice.userId, 'android', 'a-android');
    const expiresAt = Date.now() + 60000;
    await invite({ callId: 'gci-call-android', expiresAt });

    expect(pushReqs()).toHaveLength(0);
    expect(mockFcmMessages).toHaveLength(1);
    const msg = mockFcmMessages[0];
    expect(msg.token).toBe(tok('a-android'));
    expect(Object.keys(msg).sort()).toEqual(['android', 'data', 'token']);
    expect(msg).not.toHaveProperty('notification');
    expect(msg).not.toHaveProperty('apns');
    expect(msg).not.toHaveProperty('webpush');
    expect(Object.keys(msg.data).sort()).toEqual(FCM_KEYS);
    expect(msg.data).not.toHaveProperty('from');   // FCM 保留键
    for (const v of Object.values(msg.data)) expect(typeof v).toBe('string');
    expect(msg.data).toEqual({
      type: 'group_call_invite',
      recipientId: alice.userId,
      callId: 'gci-call-android',
      conversationId: convId,
      callType: 'audio',
      fromId: starter.userId,
      fromName: FROM_NAME,
      groupName: '测试群',
      expiresAt: String(expiresAt),
      senderName: '测试群',
      body: `${FROM_NAME} 邀请你加入群语音通话`,
      messageId: 'gci-call-android',
    });
    expect(msg.android.priority).toBe('high');
    expect(Number.isInteger(msg.android.ttl)).toBe(true);
    expect(msg.android.ttl).toBeGreaterThan(0);
    expect(msg.android.ttl).toBeLessThanOrEqual(60000);

    // validateMessage 会原地把 ttl 改写成 "60s" 字符串：先做完数值断言，再对深拷贝校验
    const { validateMessage } = jest.requireActual('../node_modules/firebase-admin/lib/messaging/messaging-internal');
    const copy = JSON.parse(JSON.stringify(msg));
    expect(() => validateMessage(copy)).not.toThrow();
  });

  test('仅 getui 令牌：个推透传 12 键 + 厂商通道 intent 进群且不带 1v1 来电 extra，request_id 幂等', async () => {
    insertToken(bob.userId, 'getui', 'b-getui');
    const expiresAt = Date.now() + 60000;
    await invite({ callId: 'gci-call-getui', expiresAt });

    expect(mockFcmMessages).toHaveLength(0);
    const reqs = pushReqs();
    expect(reqs).toHaveLength(1);
    const m = reqs[0];
    expect(m.audience.cid).toEqual([tok('b-getui')]);

    const tr = JSON.parse(m.push_message.transmission);
    expect(Object.keys(tr).sort()).toEqual(GETUI_KEYS);
    for (const v of Object.values(tr)) expect(typeof v).toBe('string');
    expect(tr).toEqual({
      title: '测试群',
      body: `${FROM_NAME} 邀请你加入群语音通话`,
      type: 'group_call_invite',
      recipientId: bob.userId,
      callId: 'gci-call-getui',
      conversationId: convId,
      callType: 'audio',
      fromId: starter.userId,
      fromName: FROM_NAME,
      groupName: '测试群',
      expiresAt: String(expiresAt),
      messageId: 'gci-call-getui',
    });

    expect(m.request_id).toHaveLength(32);
    expect(m.settings.ttl).toBeGreaterThanOrEqual(1000);
    expect(m.settings.ttl).toBeLessThanOrEqual(60000);

    const n = m.push_channel.android.ups.notification;
    expect(n.title).toBe('测试群');
    expect(n.body).toBe(tr.body);
    expect(n.click_type).toBe('intent');
    expect(n.notify_id).toBe(notificationId(bob.userId, convId));
    expect(n.intent.startsWith('intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.touliao.app;component=com.touliao.app/com.touliao.app.MainActivity;')).toBe(true);
    expect(n.intent.endsWith(';end')).toBe(true);
    expect(n.intent).toContain(`S.recipientId=${encodeURIComponent(bob.userId)};`);
    expect(n.intent).toContain(`S.conversationId=${encodeURIComponent(convId)};`);
    expect(n.intent).toContain('S.groupCallId=gci-call-getui;');
    expect(n.intent).toContain('S.groupCallType=audio;');
    expect(n.intent).toContain(`S.groupCallFromId=${encodeURIComponent(starter.userId)};`);
    expect(n.intent).toContain(`S.groupCallFromName=${encodeURIComponent(FROM_NAME)};`);
    expect(n.intent).toContain(`S.groupInviteExpiresAt=${expiresAt};`);
    // 旧版 MainActivity 只要 intent 带 callId 就当 1v1 来电：这几个键绝不能出现
    for (const banned of ['S.callId=', 'S.callFrom=', 'S.callerName=', 'S.callType=']) expect(n.intent).not.toContain(banned);
    expect(m.push_channel.android.ups.options).toEqual({
      HW: {
        '/message/android/notification/importance': 'NORMAL',
        '/message/android/notification/channel_id': 'touliao_messages_s1_v0',
      },
      XM: { '/extra.notify_effect': '1' },
    });

    // 同一参数再发一次：request_id 不变（个推按它幂等去重）
    mockGetuiRequests.length = 0;
    await invite({ callId: 'gci-call-getui', expiresAt });
    expect(pushReqs()).toHaveLength(1);
    expect(pushReqs()[0].request_id).toBe(m.request_id);
  });

  test('同一登录会话同时有 android + getui：只发 FCM，不发个推；另一会话的 getui 照发', async () => {
    insertToken(alice.userId, 'android', 'a-android');
    insertToken(alice.userId, 'getui', 'a-getui');
    await invite();
    expect(mockFcmMessages.map(m => m.token)).toEqual([tok('a-android')]);
    expect(pushReqs()).toHaveLength(0);

    // 另一台只有个推的手机（另一个登录会话）不受影响
    mockFcmMessages.length = 0;
    insertToken(alice.userId, 'getui', 'a-getui-other-phone', newSession(alice.userId));
    await invite({ callId: 'gci-call-two-phones' });
    expect(mockFcmMessages.map(m => m.token)).toEqual([tok('a-android')]);
    expect(pushReqs().map(r => r.audience.cid[0])).toEqual([tok('a-getui-other-phone')]);
  });

  test('只有 iOS 令牌与 Web 订阅：FCM / 个推 / Web Push 全部零发送', async () => {
    insertToken(carol.userId, 'ios', 'c-ios');
    insertToken(carol.userId, 'ios_apns', 'c-ios-apns');
    insertToken(carol.userId, 'ios_voip', 'c-ios-voip');
    const endpoint = `https://fcm.googleapis.com/fcm/send/${tok('c-web')}`;
    db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, subscription) VALUES (?, ?, ?, ?)')
      .run(tok('c-web-id'), carol.userId, endpoint, JSON.stringify({ endpoint, keys: { p256dh: 'x', auth: 'y' } }));
    await invite();
    expect(firebaseAdmin.__send).not.toHaveBeenCalled();
    expect(pushReqs()).toHaveLength(0);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  test('跳过发起人本人、对本群免打扰的成员、忙线成员', async () => {
    insertToken(starter.userId, 'android', 's-android');
    insertToken(alice.userId, 'android', 'a-android');
    insertToken(bob.userId, 'android', 'b-android');
    insertToken(bob.userId, 'getui', 'b-getui', newSession(bob.userId));
    insertToken(carol.userId, 'android', 'c-android');
    db.prepare('INSERT OR REPLACE INTO conversation_settings (user_id, conversation_id, muted) VALUES (?, ?, 1)').run(carol.userId, convId);
    const isBusy = jest.fn(uid => uid === bob.userId);

    await invite({ isBusy });

    expect(mockFcmMessages.map(m => m.token)).toEqual([tok('a-android')]);
    expect(pushReqs()).toHaveLength(0);
    // 忙线判定按用户缓存：bob 两台设备只问一次；发起人、免打扰成员不必问
    expect(isBusy.mock.calls.filter(([uid]) => uid === bob.userId)).toHaveLength(1);
    expect(isBusy).not.toHaveBeenCalledWith(starter.userId);
    expect(isBusy).not.toHaveBeenCalledWith(carol.userId);
  });

  test('邀请已过期 / 缺 callId / 缺 conversationId / expiresAt 非法：整次零发送', async () => {
    insertToken(alice.userId, 'android', 'a-android');
    insertToken(bob.userId, 'getui', 'b-getui');
    await invite({ expiresAt: Date.now() - 1 });
    await invite({ callId: '' });
    await invite({ conversationId: '' });
    await invite({ expiresAt: 'not-a-number' });
    await pushGroupCallInvite();   // 参数缺省也不抛
    expect(firebaseAdmin.__send).not.toHaveBeenCalled();
    expect(pushReqs()).toHaveLength(0);
  });

  test('英文用户：文案按被邀请人语言；发起人名为空时用「A group member」；群名为空时标题用本地化默认值', async () => {
    db.prepare("INSERT INTO user_settings (user_id, lang) VALUES (?, 'en') ON CONFLICT(user_id) DO UPDATE SET lang='en'").run(alice.userId);
    insertToken(alice.userId, 'android', 'a-android');
    insertToken(bob.userId, 'android', 'b-android');   // bob 仍是中文

    await invite({ fromName: '王五' });
    const byRecipient = Object.fromEntries(mockFcmMessages.map(m => [m.data.recipientId, m.data]));
    expect(byRecipient[alice.userId].body).toBe('王五 invited you to a group voice call');
    expect(byRecipient[alice.userId].senderName).toBe('测试群');
    expect(byRecipient[bob.userId].body).toBe('王五 邀请你加入群语音通话');

    mockFcmMessages.length = 0;
    await invite({ fromName: '', callId: 'gci-call-no-name' });
    const en = mockFcmMessages.find(m => m.data.recipientId === alice.userId).data;
    expect(en.body.startsWith('A group member')).toBe(true);
    expect(en.body).toBe('A group member invited you to a group voice call');
    expect(en.fromName).toBe('');
    expect(mockFcmMessages.find(m => m.data.recipientId === bob.userId).data.body).toBe('群成员 邀请你加入群语音通话');

    mockFcmMessages.length = 0;
    await invite({ conversationId: unnamedConvId, callId: 'gci-call-unnamed' });
    expect(mockFcmMessages).toHaveLength(1);
    expect(mockFcmMessages[0].data.groupName).toBe('');
    expect(mockFcmMessages[0].data.senderName).toBe('Group call invitation');
  });

  test('视频通话：callType=video，正文用群视频通话文案，intent 的 S.groupCallType=video', async () => {
    insertToken(alice.userId, 'android', 'a-android');
    insertToken(bob.userId, 'getui', 'b-getui');
    await invite({ callType: 'video', callId: 'gci-call-video' });

    expect(mockFcmMessages).toHaveLength(1);
    expect(mockFcmMessages[0].data.callType).toBe('video');
    expect(mockFcmMessages[0].data.body).toBe(`${FROM_NAME} 邀请你加入群视频通话`);
    const [m] = pushReqs();
    const tr = JSON.parse(m.push_message.transmission);
    expect(tr.callType).toBe('video');
    expect(tr.body).toBe(`${FROM_NAME} 邀请你加入群视频通话`);
    expect(m.push_channel.android.ups.notification.intent).toContain('S.groupCallType=video;');
  });

  test('FCM 回报令牌失效：清理该 device_tokens 行；其他错误只记日志、保留令牌', async () => {
    insertToken(alice.userId, 'android', 'a-android');
    firebaseAdmin.__send.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('gone'), { code: 'messaging/registration-token-not-registered' })));
    await expect(invite()).resolves.toBeUndefined();
    expect(db.prepare('SELECT 1 FROM device_tokens WHERE token=?').get(tok('a-android'))).toBeUndefined();

    insertToken(alice.userId, 'android', 'a-android-2');
    firebaseAdmin.__send.mockImplementationOnce(() => { throw Object.assign(new Error('boom'), { code: 'messaging/internal-error' }); });
    await expect(invite({ callId: 'gci-call-fcm-error' })).resolves.toBeUndefined();
    expect(db.prepare('SELECT 1 FROM device_tokens WHERE token=?').get(tok('a-android-2'))).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith('[group-call-push] FCM 群邀请失败:', 'messaging/internal-error');
  });

  test('个推业务失败：pushGroupCallInviteToCid 抛错，pushGroupCallInvite 吞掉只记日志', async () => {
    insertToken(bob.userId, 'getui', 'b-getui');
    mockGetuiPushCode = 20001;
    await expect(invite()).resolves.toBeUndefined();
    expect(pushReqs()).toHaveLength(1);
    expect(warnSpy.mock.calls.some(([line]) => String(line).includes('[group-call-push] 个推群邀请失败'))).toBe(true);

    await expect(getuiPush.pushGroupCallInviteToCid(tok('b-getui'), {
      recipientId: bob.userId, callId: 'gci-direct', conversationId: convId, callType: 'audio',
      fromId: starter.userId, fromName: FROM_NAME, groupName: '测试群', expiresAt: Date.now() + 60000,
      title: '测试群', body: 'x',
    })).rejects.toThrow('个推群通话邀请推送失败');
  });
});

describe('getuiPush.pushGroupCallInviteToCid', () => {
  const base = () => ({
    recipientId: 'fixture-recipient', callId: 'fixture-call', conversationId: 'fixture-group', callType: 'audio',
    fromId: 'fixture-from', fromName: 'fixture', groupName: 'g', expiresAt: Date.now() + 60000, title: 'g', body: 'b',
  });

  beforeEach(() => {
    mockGetuiRequests.length = 0;
    mockExpiredAuthOnce = false;
    mockGetuiPushCode = 0;
  });

  test('个推 auth token 过期：刷新一次后用同一 request_id 重发', async () => {
    mockExpiredAuthOnce = true;
    const res = await getuiPush.pushGroupCallInviteToCid('fixture-cid', base());
    expect(res).toMatchObject({ status: 200, cid: 'fixture-cid' });
    const pushes = pushReqs();
    expect(pushes).toHaveLength(2);
    expect(pushes[0].request_id).toBe(pushes[1].request_id);
    expect(mockGetuiRequests.some(r => r.url.endsWith('/auth'))).toBe(true);
  });

  test('发送前令牌已换绑（isCurrent=false）：不发、不抛错', async () => {
    const res = await getuiPush.pushGroupCallInviteToCid('fixture-cid', { ...base(), isCurrent: () => false });
    expect(res).toMatchObject({ skipped: true, cid: 'fixture-cid' });
    expect(pushReqs()).toHaveLength(0);
  });

  test('ttl 夹在 1~60 秒；超长 emoji 名字按字符截 32 个，不会把 emoji 切坏', async () => {
    const longName = '😀'.repeat(40);
    await getuiPush.pushGroupCallInviteToCid('fixture-cid', { ...base(), callId: 'ttl-low', fromName: longName, expiresAt: Date.now() + 10 });
    await getuiPush.pushGroupCallInviteToCid('fixture-cid', { ...base(), callId: 'ttl-high', expiresAt: Date.now() + 10 * 60 * 1000 });
    const [low, high] = pushReqs();
    expect(low.settings.ttl).toBe(1000);
    expect(high.settings.ttl).toBe(60000);
    expect(low.push_channel.android.ups.notification.intent).toContain(`S.groupCallFromName=${encodeURIComponent('😀'.repeat(32))};`);
    expect(JSON.parse(low.push_message.transmission).fromName).toBe(longName);   // 透传保留全名
    expect(low.request_id).not.toBe(high.request_id);   // 不同 callId 不会被个推误判为重复
  });
});
