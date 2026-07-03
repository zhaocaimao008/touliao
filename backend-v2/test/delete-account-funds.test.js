'use strict';
/**
 * 自助注销资金结算测试。
 * 覆盖：① 无资金用户可直接注销（软删）；② 钱包有余额拒绝注销；
 *       ③ 发出的在途红包未领 → 注销时剩余原路退回本人钱包并标记 expired，
 *          退回后余额 > 0 故被拦截（不吞钱、不重复退）。
 * 全程 Bearer token 鉴权（免 CSRF），隔离测试库，限流已关（见 testEnv.js）。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const wallet = require('../src/modules/wallet/wallet.service');
const { db } = require('../src/db/connection');

async function del(user, password) {
  return request(app)
    .post('/api/auth/delete-account')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ password: password ?? user.password });
}

describe('自助注销·资金结算', () => {
  test('无资金用户可直接注销（软删 banned=1）', async () => {
    const u = await makeUser({ username: 'del_clean' });
    const res = await del(u);
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT banned, username FROM users WHERE id=?').get(u.userId);
    expect(row.banned).toBe(1);
    expect(row.username.startsWith('已注销')).toBe(true);
  });

  test('钱包有余额时拒绝注销并提示先提现/清零', async () => {
    const u = await makeUser({ username: 'del_hasbalance' });
    wallet.applyDelta(u.userId, 500, 'test_seed', null, '测试入账');
    const res = await del(u);
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('WALLET_NOT_EMPTY');
    // 拒绝后账号仍正常（未被软删）
    const row = db.prepare('SELECT banned FROM users WHERE id=?').get(u.userId);
    expect(row.banned).toBeFalsy();
    // 余额未被吞/未被转走
    expect(wallet.getBalance(u.userId)).toBe(500);
  });

  test('在途红包注销时原路退回本人并标记 expired，退回后余额>0被拦截', async () => {
    const sender = await makeUser({ username: 'del_rp_sender' });
    const receiver = await makeUser({ username: 'del_rp_receiver' });
    await befriend(sender, receiver);
    const conversationId = await privateConversation(sender, receiver);

    // 先入账再发红包（发红包会全额扣款并预扣到 red_packets）
    wallet.applyDelta(sender.userId, 100, 'test_seed', null, '测试入账');
    const sendRes = await request(app).post('/api/messages/red-packet/send')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ conversationId, totalAmount: 100, totalCount: 1, greeting: '恭喜' });
    expect(sendRes.status).toBe(200);
    const packetId = sendRes.body.packetId;
    // 发完余额为 0（全额预扣）
    expect(wallet.getBalance(sender.userId)).toBe(0);

    // 收方不领，发送方直接注销 → 剩余 100 原路退回发送方，余额变 100 被拦截
    const res = await del(sender);
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('WALLET_NOT_EMPTY');

    // 红包已标记 expired（不会重复退）
    const p = db.prepare('SELECT status FROM red_packets WHERE id=?').get(packetId);
    expect(p.status).toBe('expired');
    // 退款流水存在且金额正确
    const refundTx = db.prepare(
      "SELECT amount FROM wallet_transactions WHERE user_id=? AND type='red_packet_refund' AND ref_id=?"
    ).get(sender.userId, packetId);
    expect(refundTx).toBeTruthy();
    expect(refundTx.amount).toBe(100);
    // 余额恰为退回金额，账号未软删
    expect(wallet.getBalance(sender.userId)).toBe(100);
    expect(db.prepare('SELECT banned FROM users WHERE id=?').get(sender.userId).banned).toBeFalsy();

    // 再次注销仍被拦截，且不会二次退款（退款流水仍只有一条）
    const res2 = await del(sender);
    expect(res2.status).toBe(400);
    const cnt = db.prepare(
      "SELECT COUNT(*) c FROM wallet_transactions WHERE user_id=? AND type='red_packet_refund' AND ref_id=?"
    ).get(sender.userId, packetId).c;
    expect(cnt).toBe(1);
  });
});
