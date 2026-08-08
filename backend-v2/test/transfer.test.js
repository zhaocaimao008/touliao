'use strict';
/**
 * 好友转账功能测试：POST /api/wallet/transfer
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser, befriend, privateConversation } = require('./helpers');

// 充值辅助（enableFakeRecharge=true 环境下才走得通；测试 env 已设置）
async function recharge(token, amount) {
  return request(app)
    .post('/api/wallet/recharge')
    .set('Authorization', `Bearer ${token}`)
    .send({ amount });
}

describe('好友转账', () => {
  let u1, u2;

  beforeAll(async () => {
    u1 = await makeUser();
    u2 = await makeUser();
    await befriend(u1, u2);
    await privateConversation(u1, u2);  // 确保私聊会话存在
    // 给 u1 充值 500 金币
    await recharge(u1.token, 500);
  });

  test('正常转账：u1 → u2，余额正确增减，transactions 有两条', async () => {
    // 转账前获取 u2 余额
    const b2before = (await request(app).get('/api/wallet').set('Authorization', `Bearer ${u2.token}`)).body.balance;

    const res = await request(app)
      .post('/api/wallet/transfer')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ to_user_id: u2.userId, amount: 100 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // u1 余额应减少 100
    expect(res.body.balance).toBe(500 - 100);
    // message 字段存在，类型为 transfer
    expect(res.body.message).toBeDefined();
    expect(res.body.message.type).toBe('transfer');
    const parsed = JSON.parse(res.body.message.content);
    expect(parsed.amount).toBe(100);

    // u2 余额应增加 100
    const b2after = (await request(app).get('/api/wallet').set('Authorization', `Bearer ${u2.token}`)).body.balance;
    expect(b2after).toBe(b2before + 100);

    // 双方各有一条 transfer_out / transfer_in 流水
    const t1 = (await request(app).get('/api/wallet/transactions').set('Authorization', `Bearer ${u1.token}`)).body;
    const t2 = (await request(app).get('/api/wallet/transactions').set('Authorization', `Bearer ${u2.token}`)).body;
    expect(t1.some(t => t.type === 'transfer_out')).toBe(true);
    expect(t2.some(t => t.type === 'transfer_in')).toBe(true);
  });

  test('余额不足时返回 400', async () => {
    const res = await request(app)
      .post('/api/wallet/transfer')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ to_user_id: u2.userId, amount: 20000 });
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('WALLET_INSUFFICIENT');
  });

  test('金额为 0 时返回 400', async () => {
    const res = await request(app)
      .post('/api/wallet/transfer')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ to_user_id: u2.userId, amount: 0 });
    expect(res.status).toBe(400);
  });

  test('金额超过 20000 时返回 400', async () => {
    const res = await request(app)
      .post('/api/wallet/transfer')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ to_user_id: u2.userId, amount: 20001 });
    expect(res.status).toBe(400);
  });

  test('不能给自己转账', async () => {
    const res = await request(app)
      .post('/api/wallet/transfer')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ to_user_id: u1.userId, amount: 10 });
    expect(res.status).toBe(400);
  });

  test('收款人不存在时返回 404', async () => {
    const res = await request(app)
      .post('/api/wallet/transfer')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ to_user_id: 'nonexistent-user-id', amount: 10 });
    expect(res.status).toBe(404);
  });

  test('未登录时返回 401', async () => {
    const res = await request(app)
      .post('/api/wallet/transfer')
      .send({ to_user_id: u2.userId, amount: 10 });
    expect(res.status).toBe(401);
  });

  test('转账带备注，content 中包含 note 字段', async () => {
    const res = await request(app)
      .post('/api/wallet/transfer')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ to_user_id: u2.userId, amount: 50, note: '请客吃饭' });
    expect(res.status).toBe(200);
    const content = JSON.parse(res.body.message.content);
    expect(content.note).toBe('请客吃饭');
  });
});
