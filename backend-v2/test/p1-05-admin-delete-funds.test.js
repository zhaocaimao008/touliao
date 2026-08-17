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

  test('洞 A：删用户不得删其领取他人红包的领取行（防 remaining 虚增 double refund）', async () => {
    // B 发 100/1 红包，victim 领光 → victim 被 admin 删 →
    // 修复前 DELETE claims WHERE user_id=victim 使 SUM(claimed)=0 → remaining 虚增回 100
    // → 到期回收 B 再收 100（同一笔钱付两次）。修复后领取行保留，remaining=0，不再退款。
    const sender = await makeUser({ username: 'adm_holeA_sender' });
    const victim = await makeUser({ username: 'adm_holeA_victim' });
    await befriend(sender, victim);
    const conversationId = await privateConversation(sender, victim);

    wallet.applyDelta(sender.userId, 100, 'test_seed', null, '测试入账');
    const sendRes = await request(app)
      .post('/api/messages/red-packet/send')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ conversationId, totalAmount: 100, totalCount: 1, greeting: '洞A' });
    expect(sendRes.status).toBe(200);
    const packetId = sendRes.body.packetId;

    // victim 领取（领光 100）
    const claimRes = await request(app)
      .post(`/api/messages/red-packet/${packetId}/claim`)
      .set('Authorization', `Bearer ${victim.token}`)
      .send({});
    expect(claimRes.status).toBe(200);
    expect(db.prepare('SELECT * FROM red_packet_claims WHERE packet_id=? AND user_id=?').get(packetId, victim.userId)).toBeTruthy();

    // admin 删除 victim
    const del = await adminDeleteUser(victim.userId);
    expect(del.status).toBe(200);

    // ① 领取行保留（转移给 ghost 占位用户，不再物理删除）——remaining 不虚增
    const GHOST_ID = '00000000-0000-0000-0000-000000000000';
    expect(db.prepare('SELECT * FROM red_packet_claims WHERE packet_id=? AND user_id=?').get(packetId, GHOST_ID)).toBeTruthy();
    // ② SUM(claimed) 仍为 100 → remaining=0
    const { s } = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM red_packet_claims WHERE packet_id=?').get(packetId);
    expect(s).toBe(100);
    // ③ 红包仍在途（status=active），到期回收不会产生退款（remaining=0）→ 不 double refund
    const packet = db.prepare('SELECT total_amount, status FROM red_packets WHERE id=?').get(packetId);
    expect(packet.status).toBe('active');
    expect(packet.total_amount - s).toBe(0);
  });

  test('洞 B：群解散分支须先结算他人（已退群成员）发出的在途红包', async () => {
    // member 发 100/1 红包后退群 → 群主（无其他成员）被 admin 删 → 整群解散
    // 修复前：DELETE red_packets WHERE conversation_id=该群 直接销毁红包，零记账（资金凭空消失）
    // 修复后：解散前 settleConversationPacketsTx 将剩余 100 原路退回 member 钱包 + ledger
    const owner = await makeUser({ username: 'adm_holeB_owner' });
    const member = await makeUser({ username: 'adm_holeB_member' });
    await befriend(owner, member);
    // 建群：owner 拉 member（memberIds 需为联系人）
    const groupRes = await request(app)
      .post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '洞B群', memberIds: [member.userId] });
    expect(groupRes.status).toBe(200);
    const groupId = groupRes.body.id || groupRes.body.conversationId;
    expect(groupId).toBeTruthy();

    wallet.applyDelta(member.userId, 100, 'test_seed', null, '测试入账');
    const sendRes = await request(app)
      .post('/api/messages/red-packet/send')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ conversationId: groupId, totalAmount: 100, totalCount: 1, greeting: '洞B' });
    expect(sendRes.status).toBe(200);
    const packetId = sendRes.body.packetId;

    // member 退群
    await request(app)
      .post(`/api/messages/conversation/${groupId}/leave`)
      .set('Authorization', `Bearer ${member.token}`);

    // admin 删群主（群无其他成员 → 解散）
    const del = await adminDeleteUser(owner.userId);
    expect(del.status).toBe(200);

    // ① member 收到 100 退款（settleConversationPacketsTx 原路退回）
    const refundTx = db.prepare(
      "SELECT COUNT(*) c, SUM(amount) s FROM wallet_transactions WHERE user_id=? AND type='red_packet_refund' AND ref_id=?"
    ).get(member.userId, packetId);
    expect(refundTx.c).toBe(1);
    expect(refundTx.s).toBe(100);
    // ② member 钱包余额 = 100（退款入账；没有其它扣减）
    expect(wallet.getBalance(member.userId)).toBe(100);
    // ③ 群已删除
    expect(db.prepare('SELECT id FROM conversations WHERE id=?').get(groupId)).toBeUndefined();
  });

  test('删除不存在用户 → 404', async () => {
    const del = await adminDeleteUser('no-such-user');
    expect(del.status).toBe(404);
  });
});
