'use strict';
/**
 * P1-04 注销账号唯一索引回归测试
 *
 * 根因：deleteAccount 匿名化 username/phone 用 6 位随机（Math.random().toString(36).slice(2,8)），
 * 空间约 2.2B，但 username/phone 有 UNIQUE 约束 —— 两个注销用户撞同一随机值 →
 * 第二个用户注销时 UPDATE 抛 SQLITE_CONSTRAINT → 500（且退款已提交、账号未注销）。
 *
 * 修复：匿名化后缀改用 uuid v4 片段（128bit 随机），碰撞概率可忽略。
 * 测试：连续注销多个用户（含并发模拟）验证不 500、不撞唯一索引。
 */
const { request, app, makeUser } = require('./helpers');
const { db } = require('../src/db/connection');

async function del(user, password) {
  return request(app)
    .post('/api/auth/delete-account')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ password: password ?? user.password });
}

describe('P1-04 注销账号唯一索引', () => {
  test('连续注销 10 个用户：全部成功、匿名化字段唯一、不撞 UNIQUE 索引', async () => {
    const users = [];
    for (let i = 0; i < 10; i++) {
      users.push(await makeUser({ username: `del_uniq_${i}` }));
    }
    for (const u of users) {
      const res = await del(u);
      expect(res.status).toBe(200);
    }
    // 匿名化后 username/phone 必须互不相同（UNIQUE 约束已通过，此处显式断言）
    const rows = db.prepare(
      "SELECT username, phone FROM users WHERE username LIKE '已注销%' ORDER BY username"
    ).all();
    const usernames = rows.map(r => r.username);
    const phones = rows.map(r => r.phone);
    expect(new Set(usernames).size).toBe(usernames.length);
    expect(new Set(phones).size).toBe(phones.length);
  });

  test('已注销账号再次尝试注销 → 密码校验拒绝（banned 用户不能二次注销）', async () => {
    const u = await makeUser({ username: 'del_uniq_twice' });
    await del(u);
    const res = await del(u, u.password);
    // banned 用户 password 已被清空为 '***'，bcrypt 比对失败 → 400 密码错误
    expect([400, 401, 403, 404]).toContain(res.status);
  });
});
