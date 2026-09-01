'use strict';
/**
 * 回归：来电推送(pushCallInvite)的个推(getui)通道覆盖。
 *
 * 背景（2026-09-01 分析结论）：
 *  - pushCallInvite 原只查 platform IN ('android','ios','ios_apns','ios_voip')，
 *    无 GMS 的国产 ROM 用户（仅注册 getui CID，占生产 device_tokens 44%）离线时收不到来电。
 *  - 修复：查询加 'getui'；有 android(FCM) token 的设备 FCM 优先，个推不重复推（防双弹）。
 *
 * 本测试验证两条行为契约：
 *  1. 仅 getui token 的用户 → 走个推 pushCallToCid：透传 type=call 字段齐全、
 *     厂商通道 intent 带 callId/callFrom/callerName/callType（与 NotificationHelper.EXTRA_CALL_* 对齐）。
 *  2. android + getui 并存（GMS 设备双注册）→ 只发 FCM，不发个推（防同一设备双弹来电）。
 *
 * 依赖 mock：个推走 https（jest.mock 捕获请求体）；FCM 走 firebase-admin（jest.mock）。
 */

// ── 必须在 require push.js 之前设 env（getuiPush 模块顶部读 env 固定）────
process.env.GETUI_APP_ID = 'test-app-id';
process.env.GETUI_APP_KEY = 'test-app-key';
process.env.GETUI_MASTER_SECRET = 'test-master-secret';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test.com';
process.env.FIREBASE_PRIVATE_KEY = 'test-key';

const https = require('https');

// 捕获个推 HTTP 请求体（/auth + /push/single/cid）
const getuiRequests = [];
jest.mock('https', () => {
  const { Readable } = require('stream');
  const real = jest.requireActual('https');
  return {
    ...real,
    request: (url, options, cb) => {
      const fakeRes = new Readable({ read() {} });
      fakeRes.statusCode = 200;
      const body = JSON.stringify({ code: 0, data: { token: 'gt-token' } });
      process.nextTick(() => {
        fakeRes.push(Buffer.from(body));
        fakeRes.push(null);
      });
      const req = {
        on: (ev, fn) => { if (ev === 'error' || ev === 'timeout') { /* noop */ } return req; },
        write: (chunk) => {
          const urlStr = typeof url === 'string' ? url : url.href;
          getuiRequests.push({ url: urlStr, body: JSON.parse(chunk.toString()) });
        },
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

// FCM mock：record 发送的 token
const fcmSentTokens = [];
jest.mock('firebase-admin', () => {
  const send = jest.fn((msg) => { fcmSentTokens.push(msg.token); return Promise.resolve('fcm-id'); });
  return {
    apps: [],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn(() => ({ projectId: 'p', clientEmail: 'e', privateKey: 'k' })) },
    messaging: () => ({ send }),
  };
});

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(() => Promise.resolve()),
}));

const { pushCallInvite } = require('../src/utils/push');
const { db } = require('../src/db/connection');

function insertToken(userId, id, token, platform) {
  db.prepare(
    'INSERT OR REPLACE INTO device_tokens (id, user_id, token, platform) VALUES (?,?,?,?)'
  ).run(id, userId, token, platform);
}

describe('来电推送个推通道（pushCallInvite getui 覆盖）', () => {
  let u;
  beforeAll(async () => {
    // 复用注册接口造真实用户（helpers.makeUser 走真实 HTTP，token 表在隔离测试库）
    const { makeUser } = require('./helpers');
    u = await makeUser({ username: 'gt_call' });
  });

  beforeEach(() => {
    getuiRequests.length = 0;
    fcmSentTokens.length = 0;
    // 清掉该用户的全部 token，保证每个用例独立
    db.prepare('DELETE FROM device_tokens WHERE user_id=?').run(u.userId);
  });

  test('仅 getui token（无 GMS 国产 ROM）→ 走个推透传+厂商通道，字段与 FCM data-only 对齐', async () => {
    insertToken(u.userId, 'gt-1', 'getui-cid-abc123', 'getui');

    await pushCallInvite({
      toUserId: u.userId,
      fromUserId: 'caller-uuid-1',
      callerName: '测试主叫',
      callType: 'video',
      callId: 'call-uuid-1',
    });

    const pushReqs = getuiRequests.filter(r => r.url.includes('/push/single/cid'));
    expect(pushReqs.length).toBe(1);
    const msg = pushReqs[0].body;
    // 透传：type=call + 四个来电字段（客户端 TouliaoGeTuiService 按此弹全屏来电）
    const transmission = JSON.parse(msg.push_message.transmission);
    expect(transmission.type).toBe('call');
    expect(transmission.callId).toBe('call-uuid-1');
    expect(transmission.from).toBe('caller-uuid-1');
    expect(transmission.callerName).toBe('测试主叫');
    expect(transmission.callType).toBe('video');
    // 厂商通道：intent 带四个 extra（键名与 NotificationHelper.EXTRA_CALL_* 对齐：callId/callFrom/callerName/callType）
    const intent = msg.push_channel.android.ups.notification.intent;
    expect(intent).toContain('S.callId=call-uuid-1');
    expect(intent).toContain('S.callFrom=caller-uuid-1');
    expect(intent).toContain('S.callerName=');
    expect(intent).toContain('S.callType=video');
    // audience 指向该 CID
    expect(msg.audience.cid).toEqual(['getui-cid-abc123']);
  });

  test('android(FCM) + getui 并存（GMS 设备双注册）→ 只发 FCM，不发个推（防双弹）', async () => {
    insertToken(u.userId, 'fcm-1', 'fcm-token-xyz', 'android');
    insertToken(u.userId, 'gt-2', 'getui-cid-abc456', 'getui');

    await pushCallInvite({
      toUserId: u.userId,
      fromUserId: 'caller-uuid-2',
      callerName: '主叫2',
      callType: 'audio',
      callId: 'call-uuid-2',
    });

    // FCM 收到（data-only type=call，android priority high）
    expect(fcmSentTokens).toContain('fcm-token-xyz');
    const fcmMsg = fcmSentTokens.length ? null : null;
    // 个推一条都没发
    expect(getuiRequests.filter(r => r.url.includes('/push/single/cid')).length).toBe(0);
    expect(fcmSentTokens).toEqual(['fcm-token-xyz']);
    expect(fcmSentTokens.length).toBe(1);
  });

  test('仅 getui token 的 audio 来电 → callType 归一为 audio', async () => {
    insertToken(u.userId, 'gt-3', 'getui-cid-audio1', 'getui');

    await pushCallInvite({
      toUserId: u.userId,
      fromUserId: 'caller-uuid-3',
      callerName: '',
      callType: 'audio',
      callId: 'call-uuid-3',
    });

    const pushReqs = getuiRequests.filter(r => r.url.includes('/push/single/cid'));
    expect(pushReqs.length).toBe(1);
    const transmission = JSON.parse(pushReqs[0].body.push_message.transmission);
    expect(transmission.callType).toBe('audio');
    expect(transmission.callerName).toBe('');   // 无名字时客户端兜底显示「来电」
  });
});
