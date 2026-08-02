'use strict';
/**
 * 回归：国产 ROM 锁屏推送两个关联 bug。
 *
 * Bug 1 (主因)：notifications.service.js saveDeviceToken 的 platform 白名单不含 'getui'。
 *   → 个推 CID 注册请求被 400 拒绝，个推 token 永远写不进 device_tokens。
 *   → push.js 里 WHERE platform='getui' 查询恒为空 → 国产 ROM 锁屏永远收不到通知。
 *
 * Bug 2 (次要)：pushToUser/pushCallInvite 取 FCM token 时 SELECT * 不过滤 platform，
 *   若个推 CID 侥幸存入会被投给 FCM → FCM 报 invalid-registration-token →
 *   清理逻辑可能误删该 CID，切断唯一锁屏通路。
 */
const { request, app, makeUser } = require('./helpers');
const { db } = require('../src/db/connection');

describe('国产 ROM 推送 platform 支持（getui 兜底）', () => {
  let u;
  beforeAll(async () => { u = await makeUser({ username: 'gt_push' }); });

  // ── Bug 1：API 必须接受 platform='getui' ────────────────────────────────
  test('注册 getui CID 应返回 200', async () => {
    const res = await request(app)
      .post('/api/notifications/device-token')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ token: 'fake-getui-cid-abc123456789', platform: 'getui' });
    expect(res.status).toBe(200);
  });

  test('getui CID 应被写入 device_tokens 表', async () => {
    const rows = db.prepare(
      "SELECT platform FROM device_tokens WHERE user_id=? AND token='fake-getui-cid-abc123456789'"
    ).all(u.userId);
    expect(rows.length).toBe(1);
    expect(rows[0].platform).toBe('getui');
  });

  // ── Bug 2：FCM 取 token 时不应包含 getui 平台 ───────────────────────────
  test('device_tokens 里的 getui CID 不应出现在 FCM android/ios 查询结果中', () => {
    // 同时写入一条 android token，模拟真实设备兼有 FCM + 个推的场景
    db.prepare(`
      INSERT OR IGNORE INTO device_tokens (id, user_id, token, platform)
      VALUES ('fcm-row-001', ?, 'fake-fcm-token-xyz', 'android')
    `).run(u.userId);

    const fcmTokens = db.prepare(
      "SELECT token, platform FROM device_tokens WHERE user_id=? AND platform IN ('android','ios')"
    ).all(u.userId);

    const getuiTokens = db.prepare(
      "SELECT token, platform FROM device_tokens WHERE user_id=? AND platform='getui'"
    ).all(u.userId);

    const fcmTokenValues = fcmTokens.map(r => r.token);
    expect(fcmTokenValues).not.toContain('fake-getui-cid-abc123456789'); // getui 不混进 FCM
    expect(fcmTokenValues).toContain('fake-fcm-token-xyz');              // FCM token 正常取到
    expect(getuiTokens.map(r => r.token)).toContain('fake-getui-cid-abc123456789');
  });

  // android / ios 原有功能不受影响
  test('注册 android token 仍返回 200', async () => {
    const res = await request(app)
      .post('/api/notifications/device-token')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ token: 'fake-fcm-android-token', platform: 'android' });
    expect(res.status).toBe(200);
  });

  test('非法 platform 仍被拒绝（400）', async () => {
    const res = await request(app)
      .post('/api/notifications/device-token')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ token: 'some-token', platform: 'unknown' });
    expect(res.status).toBe(400);
  });
});
