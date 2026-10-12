'use strict';
// 2026-10-12 后端修复批：已读空操作、/me /refresh 连续 401 退避、能力位、遥测落库、ICE 摘要、X-Accel。
const fs = require('fs');
const path = require('path');
const express = require('express');
const { app, request, makeUser } = require('./helpers');
const { db, fixture, messages, conv, io: fakeIo } = require('./batch2-fixture.cjs');
const { logger } = require('../src/utils/logger');
const config = require('../src/config');

beforeAll(() => { logger.silent = true; });
afterAll(async () => { logger.silent = false; await require('../src/db/writer').shutdown(); });

describe('markRead：水位不前进时为空操作', () => {
  test('重复上报同一条/更早的消息不广播、不改水位；手动未读后仍会清除', async () => {
    const f = fixture();
    const m1 = await messages.send(null, f.id, f.a, { content: 'one' });
    const m2 = await messages.send(null, f.id, f.a, { content: 'two' });
    const io1 = fakeIo();
    const r1 = await conv.markRead(io1, f.b, f.id, m2.id);
    expect(r1.lastReadMessageId).toBe(m2.id);
    expect(io1.events.map(e => e.name).sort()).toEqual(['message_read', 'sync:unread_cleared']);

    const io2 = fakeIo();
    const r2 = await conv.markRead(io2, f.b, f.id, m2.id);
    expect(io2.events).toHaveLength(0);
    expect(r2).toEqual({ readAt: r1.readAt, lastReadMessageId: m2.id });

    // 回读更早的消息：不再把水位往回拨
    const io3 = fakeIo();
    const r3 = await conv.markRead(io3, f.b, f.id, m1.id);
    expect(io3.events).toHaveLength(0);
    expect(r3.lastReadMessageId).toBe(m2.id);
    expect(db.prepare('SELECT last_read_message_id FROM conversation_settings WHERE user_id=? AND conversation_id=?')
      .get(f.b, f.id).last_read_message_id).toBe(m2.id);

    // 手动标为未读后，同一条再标已读必须真正执行（清 manually_unread 并同步其他端）
    await conv.markUnread(f.b, f.id);
    const io4 = fakeIo();
    await conv.markRead(io4, f.b, f.id, m2.id);
    expect(io4.events.map(e => e.name)).toContain('sync:unread_cleared');
    expect(db.prepare('SELECT manually_unread FROM conversation_settings WHERE user_id=? AND conversation_id=?')
      .get(f.b, f.id).manually_unread).toBe(0);

    // 新消息到来后水位前进 → 照常广播
    const m3 = await messages.send(null, f.id, f.a, { content: 'three' });
    const io5 = fakeIo();
    await conv.markRead(io5, f.b, f.id, m3.id);
    expect(io5.events.map(e => e.name)).toContain('message_read');
  });
});

describe('authBackoff', () => {
  const { createAuthBackoff } = require('../src/middleware/authBackoff');
  function mini(opts) {
    const a = express();
    a.set('trust proxy', true);
    const backoff = createAuthBackoff({ force: true, ...opts });
    a.get('/me', backoff, (req, res) => (req.headers.authorization === 'Bearer good'
      ? res.json({ ok: 1 }) : res.status(401).json({ error: 'x', error_code: 'UNAUTHORIZED' })));
    return a;
  }

  test('同一死 token 连续 401 达阈值后 429 + Retry-After；其他 token 不受影响', async () => {
    const a = mini({ tokenMax: 3, ipMax: 100 });
    for (let i = 0; i < 3; i++) expect((await request(a).get('/me').set('Authorization', 'Bearer dead')).status).toBe(401);
    const blocked = await request(a).get('/me').set('Authorization', 'Bearer dead');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error_code).toBe('AUTH_BACKOFF');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await request(a).get('/me').set('Authorization', 'Bearer good')).status).toBe(200);
  });

  test('IP 级退避只挡签名无效的请求，签名有效的 token 照常放行', async () => {
    const jwt = require('jsonwebtoken');
    const valid = jwt.sign({ id: 'u1' }, config.jwtSecret, { algorithm: 'HS256', expiresIn: 60 });
    const a = mini({ tokenMax: 100, ipMax: 3 });
    for (let i = 0; i < 3; i++) await request(a).get('/me').set('X-Forwarded-For', '9.9.9.9').set('Authorization', `Bearer junk${i}`);
    expect((await request(a).get('/me').set('X-Forwarded-For', '9.9.9.9').set('Authorization', 'Bearer junkX')).status).toBe(429);
    // 签名有效（这里业务层仍判 401，但退避层不拦）
    expect((await request(a).get('/me').set('X-Forwarded-For', '9.9.9.9').set('Authorization', `Bearer ${valid}`)).status).toBe(401);
    expect((await request(a).get('/me').set('X-Forwarded-For', '8.8.8.8').set('Authorization', 'Bearer junkY')).status).toBe(401);
  });

  test('成功即清零计数', async () => {
    const a = mini({ tokenMax: 100, ipMax: 3 });
    for (let i = 0; i < 2; i++) await request(a).get('/me').set('Authorization', 'Bearer bad');
    expect((await request(a).get('/me').set('Authorization', 'Bearer good')).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await request(a).get('/me').set('Authorization', 'Bearer bad')).status).toBe(401);
  });

  test('真实 /api/auth/me 401 带稳定 error_code', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe('UNAUTHORIZED');
    expect(res.body.reason).toBe('token_invalid');
    expect(typeof res.body.error).toBe('string');
  });
});

describe('能力位', () => {
  test('/api/config 暴露 features.cloudUpload / webPush，且保留原有字段', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(typeof res.body.features.cloudUpload).toBe('boolean');
    expect(typeof res.body.features.webPush).toBe('boolean');
    expect(res.body.features).toHaveProperty('moments');
    expect(res.body).toHaveProperty('minVersion');
  });
  test('VAPID 未配置时 503 + FEATURE_DISABLED', async () => {
    const res = await request(app).get('/api/notifications/vapid-public-key');
    if (config.vapid.publicKey) return; // 本机若配置了 VAPID 则跳过
    expect(res.status).toBe(503);
    expect(res.body.error_code).toBe('FEATURE_DISABLED');
    expect(res.body.feature).toBe('webPush');
  });
});

describe('遥测', () => {
  const svc = require('../src/modules/telemetry/telemetry.service');
  const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); } };

  test('vitals：校验/归一化、落库、p50/p75/p95', async () => {
    expect(svc.normalizeVital({ name: 'bogus', value: 1 })).toBeNull();
    expect(svc.normalizeVital({ name: 'LCP', value: 'NaN' })).toBeNull();
    const v = svc.normalizeVital({ name: 'lcp', value: 1234.5, url: 'https://x/chat/123e4567-e89b-12d3-a456-426614174000?a=1', userAgent: 'Mozilla (iPhone)' });
    expect(v).toMatchObject({ name: 'LCP', page: '/chat/:id', ua_class: 'ios' });
    for (let i = 1; i <= 100; i++) await svc.recordVital({ name: 'TTFB', value: i, rating: null, page: '/', ua_class: 'desktop-web' });
    const res = await request(app).post('/api/metrics/vitals').set('Content-Type', 'text/plain')
      .send(JSON.stringify({ name: 'TTFB', value: 50, url: '/' }));
    expect(res.status).toBe(204);
    await waitFor(() => db.prepare("SELECT COUNT(*) n FROM web_vitals WHERE name='TTFB'").get().n >= 101);
    const s = svc.vitalsStats(1);
    expect(s.metrics.TTFB.count).toBe(101);
    expect(s.metrics.TTFB.p50).toBe(50);
    expect(s.metrics.TTFB.p95).toBe(95);
    expect((await request(app).get('/api/metrics/vitals/stats')).status).toBe(401);
  });

  test('通话质量：校验、upsert、统计、鉴权', async () => {
    const u = await makeUser();
    const body = {
      role: 'caller', callType: 'video', group: false, connected: true, setupMs: 999999, durationSec: 30,
      endReason: 'hangup', iceRestarts: 1, localCandidateType: 'relay', remoteCandidateType: 'srflx',
      protocol: 'udp', relayProtocol: 'tls', rttMsAvg: 80, packetLossPct: 250, platform: 'android', appVersion: '8.1.44',
    };
    expect((await request(app).post('/api/calls/c1/report').send(body)).status).toBe(401);
    expect((await request(app).post('/api/calls/c1/report').set('Authorization', `Bearer ${u.token}`)
      .send({ ...body, role: 'boss' })).status).toBe(400);
    const ok = await request(app).post('/api/calls/c1/report').set('Authorization', `Bearer ${u.token}`).send(body);
    expect(ok.status).toBe(200);
    // 重复上报覆盖同一行
    await request(app).post('/api/calls/c1/report').set('Authorization', `Bearer ${u.token}`).send({ ...body, durationSec: 31 });
    const rows = db.prepare('SELECT * FROM call_reports WHERE call_id=? AND user_id=?').all('c1', u.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ setup_ms: 120000, packet_loss_pct: 100, duration_sec: 31, relay_protocol: 'tls' });
    await request(app).post('/api/calls/c2/report').set('Authorization', `Bearer ${u.token}`)
      .send({ ...body, connected: false, platform: 'web', localCandidateType: null });
    const st = svc.callStats(7);
    expect(st.overall.reports).toBeGreaterThanOrEqual(2);
    expect(st.byPlatform.android).toMatchObject({ connected: 1, connectRate: 1, relayShare: 1, medianSetupMs: 120000 });
    expect(st.byPlatform.web.connectRate).toBe(0);
    expect((await request(app).get('/api/calls/stats')).status).toBe(401);
  });

  test('ICE 候选日志摘要不含 IP', () => {
    const { describeCandidate } = require('../src/realtime/handlers/call');
    expect(describeCandidate('candidate:842163049 1 udp 1677729535 1.2.3.4 46154 typ srflx raddr 0.0.0.0 rport 0')).toBe('srflx/udp');
    expect(describeCandidate('candidate:1 1 TCP 2105458943 10.0.0.2 9 typ host tcptype active')).toBe('host/tcp(active)');
    expect(describeCandidate('')).toBe('end-of-candidates');
    expect(describeCandidate('garbage')).toBe('unknown/unknown');
  });
});

describe('logger 级别', () => {
  test('2xx/401 → debug，其他 4xx → info，5xx/慢请求 → warn', () => {
    const { requestLevel } = require('../src/utils/logger');
    expect(requestLevel(200, 5)).toBe('debug');
    expect(requestLevel(304, 5)).toBe('debug');
    expect(requestLevel(401, 5)).toBe('debug');
    expect(requestLevel(404, 5)).toBe('info');
    expect(requestLevel(503, 5)).toBe('warn');
    expect(requestLevel(200, 1500)).toBe('warn');
  });
});

describe('UPLOADS_X_ACCEL', () => {
  afterEach(() => { delete process.env.UPLOADS_X_ACCEL; });
  test('开启后鉴权通过返回空 body + X-Accel-Redirect；关闭时照常发字节', async () => {
    const { befriend, privateConversation } = require('./helpers');
    const a = await makeUser(); const b = await makeUser();
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    const up = await request(app).post(`/api/messages/${convId}/upload`).set('Authorization', `Bearer ${a.token}`)
      .attach('file', Buffer.from('xaccel bytes\n'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(up.status).toBe(200);
    const url = up.body.file_url;
    const off = await request(app).get(url).set('Authorization', `Bearer ${b.token}`);
    expect(off.status).toBe(200);
    expect(off.text).toBe('xaccel bytes\n');
    expect(off.headers['x-accel-redirect']).toBeUndefined();

    process.env.UPLOADS_X_ACCEL = '1';
    const on = await request(app).get(url).set('Authorization', `Bearer ${b.token}`);
    expect(on.status).toBe(200);
    expect(on.text || '').toBe('');
    expect(on.headers['x-accel-redirect']).toBe('/_protected_uploads' + url.slice('/uploads'.length));
    expect(on.headers['content-type']).toMatch(/text\/plain/);
    expect(on.headers['cache-control']).toMatch(/private/);
    expect(fs.existsSync(path.join(config.uploadsRoot, url.slice('/uploads/'.length)))).toBe(true);
    // 未授权仍被拦（鉴权在 X-Accel 之前）
    expect((await request(app).get(url)).status).toBe(401);
    // 路径穿越
    expect([400, 401, 403, 404]).toContain((await request(app).get('/uploads/files/..%2f..%2fetc%2fpasswd').set('Authorization', `Bearer ${b.token}`)).status);
  });
});
