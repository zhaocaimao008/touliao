'use strict';
// 2026-10-12 集成评审修复：过期真 token 不吃 IP 退避、未核验通话上报配额、vitals 分指标统计、
// config:updated 与 /api/config 同形。
const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { app, request, makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
const config = require('../src/config');
const svc = require('../src/modules/telemetry/telemetry.service');

const createdCallIds = [];
afterAll(async () => {
  for (const id of createdCallIds) db.prepare('DELETE FROM call_reports WHERE call_id=?').run(id);
  db.prepare("DELETE FROM web_vitals WHERE ua_class='zz-review-sample'").run();
  await require('../src/db/writer').shutdown();
});

describe('authBackoff：IP 退避放行过期但签名真实的 token', () => {
  const { createAuthBackoff } = require('../src/middleware/authBackoff');
  test('过期真 token 拿到业务层 401（而非 429），伪造 token 仍 429', async () => {
    const a = express();
    a.set('trust proxy', true);
    a.get('/me', createAuthBackoff({ force: true, tokenMax: 100, ipMax: 3 }),
      (req, res) => res.status(401).json({ error: 'x', reason: 'token_expired' }));
    for (let i = 0; i < 3; i++) await request(a).get('/me').set('X-Forwarded-For', '7.7.7.7').set('Authorization', `Bearer junk${i}`);
    expect((await request(a).get('/me').set('X-Forwarded-For', '7.7.7.7').set('Authorization', 'Bearer junkZ')).status).toBe(429);
    const expired = jwt.sign({ id: 'u1', exp: Math.floor(Date.now() / 1000) - 3600 }, config.jwtSecret, { algorithm: 'HS256' });
    const res = await request(a).get('/me').set('X-Forwarded-For', '7.7.7.7').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    const forged = jwt.sign({ id: 'u1' }, 'not-the-secret', { algorithm: 'HS256' });
    expect((await request(a).get('/me').set('X-Forwarded-For', '7.7.7.7').set('Authorization', `Bearer ${forged}`)).status).toBe(429);
  });
});

describe('通话上报：查无记录的未核验上报有单用户配额', () => {
  test(`超过 ${svc.UNVERIFIED_NONE_QUOTA_24H} 条后不再落库，仍回 200`, async () => {
    const u = await makeUser();
    const body = {
      role: 'caller', callType: 'audio', group: false, connected: false, durationSec: 0,
      endReason: 'hangup', platform: 'ios', appVersion: '1.0.0',
    };
    const n = svc.UNVERIFIED_NONE_QUOTA_24H;
    for (let i = 0; i < n + 2; i++) {
      const id = `zzq-${uuidv4()}`;
      createdCallIds.push(id);
      const r = await request(app).post(`/api/calls/${id}/report`).set('Authorization', `Bearer ${u.token}`).send(body);
      expect(r.status).toBe(200);
      expect(r.body.verified).toBe(false);
      if (i >= n) expect(r.body.stored).toBe(false);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM call_reports WHERE user_id=?').get(u.userId).n).toBe(n);
  });

  test('保留期修剪：删除过期行与超过 7 天的未核验行', async () => {
    const u = await makeUser();
    const now = Math.floor(Date.now() / 1000);
    const ins = (id, verified, ageDays) => {
      createdCallIds.push(id);
      db.prepare(`INSERT INTO call_reports (call_id,user_id,role,call_type,platform,verified,created_at,updated_at)
        VALUES (?,?,'caller','audio','ios',?,?,?)`).run(id, u.userId, verified, now - ageDays * 86400, now - ageDays * 86400);
    };
    ins('zzp-old-verified', 1, 100);
    ins('zzp-recent-verified', 1, 30);
    ins('zzp-old-unverified', 0, 10);
    ins('zzp-new-unverified', 0, 1);
    for (let i = 0; i < 300 && !svc.maybePruneCallReports(); i++) { /* 推进计数直到触发 */ }
    const ids = () => db.prepare("SELECT call_id FROM call_reports WHERE call_id LIKE 'zzp-%' ORDER BY call_id").all().map(r => r.call_id);
    for (let i = 0; i < 100 && ids().length !== 2; i++) await new Promise(r => setTimeout(r, 20));
    expect(ids()).toEqual(['zzp-new-unverified', 'zzp-recent-verified']);
  });
});

describe('vitalsStats：按指标分别统计', () => {
  test('超过上限的指标抽样并标记，其他指标不被挤掉', () => {
    const now = Math.floor(Date.now() / 1000);
    const total = svc.VITALS_STATS_CAP * 2 + 1000;
    const ins = db.prepare("INSERT INTO web_vitals (name,value,rating,page,ua_class,ts) VALUES (?,?,NULL,'/','zz-review-sample',?)");
    db.transaction(() => {
      for (let i = 0; i < total; i++) ins.run('CLS', (i % 1000) / 1000, now);
      for (let i = 1; i <= 100; i++) ins.run('TTFB', i, now);
    })();
    const s = svc.vitalsStats(1, { uaClass: 'zz-review-sample' });
    expect(s.metrics.CLS.count).toBe(total);
    expect(s.metrics.CLS.sampled).toBe(true);
    expect(s.metrics.CLS.sampleSize).toBeLessThan(total);
    expect(Math.abs(s.metrics.CLS.p95 - 0.95)).toBeLessThan(0.03);
    expect(s.metrics.TTFB).toMatchObject({ count: 100, p50: 50, p95: 95 });
    expect(s.metrics.TTFB.sampled).toBeUndefined();
  });
});

describe('features：config:updated 广播与 /api/config 同形', () => {
  test('publicFeatures 含能力位，与 /api/config 一致', async () => {
    const { publicFeatures } = require('../src/utils/publicFeatures');
    const f = publicFeatures();
    expect(typeof f.cloudUpload).toBe('boolean');
    expect(typeof f.webPush).toBe('boolean');
    const res = await request(app).get('/api/config');
    expect(res.body.features).toEqual(f);
  });
});
