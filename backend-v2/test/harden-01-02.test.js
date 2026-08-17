'use strict';
/**
 * HARDEN-01/02 加固回归测试
 *
 * HARDEN-01：自助注销事务 COMMIT 成功后主动断开该用户全部已建立 Socket
 *            （rollback 时不误踢正常用户）
 * HARDEN-02：ensureNumericVxinIds 跳过已注销/封禁用户（banned=1），
 *            启动补号不再给已注销用户重新分配投聊号
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser } = require('./helpers');
const { db } = require('../src/db/connection');

// ── HARDEN-01：注销后断开 Socket ──────────────────────────────
describe('HARDEN-01 注销成功后断开用户 Socket', () => {
  test('注销成功 → disconnectSockets 被调用（与 admin 删除一致）', async () => {
    const u = await makeUser({ username: 'hard01_ok', password: 'pass1234' });
    // mock io：捕获 disconnectSockets 调用
    const calls = [];
    app.set('io', { to: (room) => ({ disconnectSockets: (force) => calls.push({ room, force }) }) });
    const res = await request(app)
      .post('/api/auth/delete-account')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ password: 'pass1234' });
    expect(res.status).toBe(200);
    expect(calls.some(c => c.room === `user_${u.userId}`)).toBe(true);
    app.set('io', null);
  });

  test('注销失败（余额拦截 / 密码错误）→ 不调用 disconnectSockets', async () => {
    const u = await makeUser({ username: 'hard01_fail', password: 'pass1234' });
    const calls = [];
    app.set('io', { to: (room) => ({ disconnectSockets: (force) => calls.push({ room, force }) }) });
    // 密码错误 → 事务未开始即拒绝
    const bad = await request(app)
      .post('/api/auth/delete-account')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ password: 'wrongpass' });
    expect(bad.status).toBe(400);
    expect(calls.length).toBe(0);
    app.set('io', null);
  });
});

// ── HARDEN-02：补号逻辑跳过已注销用户 ─────────────────────────
describe('HARDEN-02 ensureNumericVxinIds 跳过已注销/封禁用户', () => {
  const { ensureNumericVxinIds } = require('../src/db/connection');

  test('正常新用户仍能补号', async () => {
    const u = await makeUser({ username: 'hard02_new' });
    db.prepare('UPDATE users SET wechat_id=NULL WHERE id=?').run(u.userId);
    ensureNumericVxinIds();
    const after = db.prepare('SELECT wechat_id FROM users WHERE id=?').get(u.userId);
    expect(after.wechat_id).toMatch(/^\d{6}$/);
  });

  test('已注销用户（banned=1, wechat_id=NULL）补号后仍保持 NULL', async () => {
    const u = await makeUser({ username: 'hard02_dead' });
    // 模拟注销状态（与 auth.service.deleteAccount 一致）
    db.prepare('UPDATE users SET banned=1, wechat_id=NULL WHERE id=?').run(u.userId);
    ensureNumericVxinIds();
    const after = db.prepare('SELECT wechat_id FROM users WHERE id=?').get(u.userId);
    expect(after.wechat_id).toBeNull();
  });

  test('封禁用户（banned=1, 有非法投聊号）不被重发', async () => {
    const u = await makeUser({ username: 'hard02_ban' });
    db.prepare("UPDATE users SET banned=1, wechat_id='abc' WHERE id=?").run(u.userId);
    ensureNumericVxinIds();
    const after = db.prepare('SELECT wechat_id FROM users WHERE id=?').get(u.userId);
    expect(after.wechat_id).toBe('abc');
  });

  test('多次启动幂等：已补号用户不被重复修改', async () => {
    const u = await makeUser({ username: 'hard02_idem' });
    const first = db.prepare('SELECT wechat_id FROM users WHERE id=?').get(u.userId).wechat_id;
    ensureNumericVxinIds();
    ensureNumericVxinIds();
    const after = db.prepare('SELECT wechat_id FROM users WHERE id=?').get(u.userId).wechat_id;
    expect(after).toBe(first);
  });

  test('不产生 UNIQUE 冲突（有效用户间重复投聊号仍被纠正）', async () => {
    const a = await makeUser({ username: 'hard02_dup_a' });
    const b = await makeUser({ username: 'hard02_dup_b' });
    const dup = '123456';
    // 唯一索引存在时无法直接写入重复值；先 DROP 索引制造重复态，
    // 补号函数末尾会重建 UNIQUE INDEX 并纠正重复（真实启动场景同款）。
    db.prepare('DROP INDEX IF EXISTS idx_users_wechat_id_unique').run();
    db.prepare('UPDATE users SET wechat_id=? WHERE id=?').run(dup, a.userId);
    db.prepare('UPDATE users SET wechat_id=? WHERE id=?').run(dup, b.userId);
    expect(() => ensureNumericVxinIds()).not.toThrow();
    const rows = db.prepare('SELECT wechat_id FROM users WHERE id IN (?,?)').all(a.userId, b.userId);
    expect(rows[0].wechat_id).not.toBe(rows[1].wechat_id);
    expect(rows.every(r => /^\d{6}$/.test(r.wechat_id))).toBe(true);
  });
});
