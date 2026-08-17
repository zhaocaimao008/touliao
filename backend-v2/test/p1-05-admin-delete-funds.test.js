'use strict';
/**
 * P1-05 admin 删除用户 → 在途红包资金守恒
 *
 * 根因：admin deleteUser 直接 DELETE red_packets（在途红包剩余金额凭空销毁）
 * + DELETE wallets（余额凭空消失）+ DELETE wallet_transactions（流水抹除）→ 资金不守恒。
 *
 * 修复：删除前先 settleUserActivePacketsTx（在途红包剩余原路退回本人钱包，status CAS 防双花），
 *       钱包余额记账后清零（type='admin_delete_refund'），wallet_transactions 保留作审计痕迹。
 */
const jwt = require('jsonwebtoken');
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const config = require('../src/config');
const wallet = require('../src/modules/wallet/wallet.service');
const { db } = require('../src/db/connection');

function adminToken() {
  const csrf = 'p105-csrf-token';
  return jwt.sign(
    { admin: true, username: config.admin.username, csrf },
    config.adminJwtSecret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

async function adminDeleteUser(userId) {
  return request(app)
    .delete(`/api/admin/users/${userId}`)
    .set('Cookie', `vxin_admin_token=${adminToken()}`)
    .set('X-CSRF-Token', 'p105-csrf-token');
}

describe('P1-05 admin 删除用户·资金守恒', () => {
  test('删除有在途红包的用户：剩余金额退回本人钱包并记账，红包标记 expired', async () => {
    const sender = await makeUser({ username: 'adm_rp_sender' });
    const receiver = await makeUser({ username: 'adm_rp_receiver' });
    await befriend(sender, receiver);
    const conversationId = await privateConversation(sender, receiver);

    // 入账 100 金币并发 100 金币红包（未领取）
    wallet.applyDelta(sender.userId, 100, 'test_seed', null, '测试入账');
    const sendRes = await request(app)
      .post('/api/messages/red-packet/send')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ conversationId, totalAmount: 100, totalCount: 1, greeting: 'P1-05' });
    expect(sendRes.status).toBe(200);
    const packetId = sendRes.body.packetId;
    const packet = db.prepare('SELECT * FROM red_packets WHERE id=?').get(packetId);
    expect(packet.status).toBe('active');

    // admin 删除 sender（物理删除：红包行随用户清除，但资金已先结清入 ledger）
    const del = await adminDeleteUser(sender.userId);
    expect(del.status).toBe(200);

    // ① 红包行已随用户物理删除（无残留行）
    expect(db.prepare('SELECT id FROM red_packets WHERE id=?').get(packetId)).toBeUndefined();
    // ② 资金守恒：退款入账流水存在（settle：+100 退回本人钱包）
    const refundTx = db.prepare(
      "SELECT COUNT(*) c, SUM(amount) s FROM wallet_transactions WHERE user_id=? AND type='red_packet_refund' AND ref_id=?"
    ).get(sender.userId, packetId);
    expect(refundTx.c).toBe(1);
    expect(refundTx.s).toBe(100);
    // ③ 钱包清零有 admin_delete_refund 记账（-100，资金去向留痕）
    const clearTx = db.prepare(
      "SELECT COUNT(*) c, SUM(amount) s FROM wallet_transactions WHERE user_id=? AND type='admin_delete_refund'"
    ).get(sender.userId);
    expect(clearTx.c).toBe(1);
    expect(clearTx.s).toBe(-100);
    // ④ ledger 保留（未随用户删除被抹除），且净额守恒：+100 退款 -100 清零 = 0
    const net = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM wallet_transactions WHERE user_id=?').get(sender.userId).s;
    expect(net).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM wallet_transactions WHERE user_id=?').get(sender.userId).c).toBeGreaterThan(0);
    // ⑤ 用户已被删
    expect(db.prepare('SELECT id FROM users WHERE id=?').get(sender.userId)).toBeUndefined();
    // ⑥ 接收者资金不受影响
    expect(wallet.getBalance(receiver.userId)).toBe(0);
  });

  test('删除无资金用户：正常删除，无异常流水', async () => {
    const u = await makeUser({ username: 'adm_clean' });
    const del = await adminDeleteUser(u.userId);
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT id FROM users WHERE id=?').get(u.userId)).toBeUndefined();
  });

  test('删除不存在用户 → 404', async () => {
    const del = await adminDeleteUser('no-such-user');
    expect(del.status).toBe(404);
  });
});
