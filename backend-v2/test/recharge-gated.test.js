'use strict';
/**
 * 充值门控回归（S-2）：自助充值无支付网关，一旦默认开启，任意登录用户即可
 * 凭限流上限自造余额（10次/h × 100000）并经红包转移给他人 —— 等同无限印钞。
 * 本测试锁定「未显式开启时必须 403」这一行为，防止将来误改默认值。
 */
require('./testEnv');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const { makeUser } = require('./helpers');

describe('钱包充值门控', () => {
  let user;
  beforeAll(async () => { user = await makeUser(); });

  test('关闭时充值被拒 403 且余额不变', async () => {
    const before = await request(app).get('/api/wallet')
      .set('Authorization', `Bearer ${user.token}`);
    const orig = config.enableFakeRecharge;
    config.enableFakeRecharge = false;          // 模拟生产默认
    try {
      const res = await request(app).post('/api/wallet/recharge')
        .set('Authorization', `Bearer ${user.token}`).send({ amount: 100000 });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('RECHARGE_DISABLED');
      const after = await request(app).get('/api/wallet')
        .set('Authorization', `Bearer ${user.token}`);
      expect(after.body.balance).toBe(before.body.balance);   // 未入账
    } finally {
      config.enableFakeRecharge = orig;
    }
  });

  test('显式开启时正常入账（联调用途）', async () => {
    const res = await request(app).post('/api/wallet/recharge')
      .set('Authorization', `Bearer ${user.token}`).send({ amount: 100 });
    expect(res.status).toBe(200);
    expect(res.body.recharged).toBe(100);
  });

  test('开启时金额边界仍受校验（负数/超上限）', async () => {
    for (const amount of [-1, 0, 100001]) {
      const res = await request(app).post('/api/wallet/recharge')
        .set('Authorization', `Bearer ${user.token}`).send({ amount });
      expect(res.status).toBe(400);
    }
  });
});
