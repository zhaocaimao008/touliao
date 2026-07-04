'use strict';
/**
 * 红包「已过期不可领」资金安全测试。
 *
 * 回归防护：注销结算 / 过期回收会把红包 status 置 'expired' 并把剩余原路退回发送者。
 * 若 claim() 只靠 24h 时间戳判断（旧行为），注销结算（不满 24h 即退款）会留下窗口：
 * 包已 expired、剩余已退给发送者，但因创建不足 24h 仍被放行 → 领取者再领一次 → 同一笔钱双花。
 * 本测试确保：status='expired' 后领取被拒、领取者余额不变、不产生领取流水（钱守恒）。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const wallet = require('../src/modules/wallet/wallet.service');
const rpService = require('../src/modules/redpackets/redpackets.service');
const { db } = require('../src/db/connection');

function claim(user, packetId) {
  return request(app)
    .post(`/api/messages/red-packet/${packetId}/claim`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({});
}

describe('红包·已过期不可领（防注销结算双花）', () => {
  test('结算标记 expired 后，领取被拒且不产生双花', async () => {
    const sender = await makeUser({ username: 'rpx_sender' });
    const receiver = await makeUser({ username: 'rpx_receiver' });
    await befriend(sender, receiver);
    const conversationId = await privateConversation(sender, receiver);

    // 充值并发红包（全额预扣）
    wallet.applyDelta(sender.userId, 100, 'test_seed', null, '测试入账');
    const sendRes = await request(app).post('/api/messages/red-packet/send')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ conversationId, totalAmount: 100, totalCount: 1, greeting: '恭喜' });
    expect(sendRes.status).toBe(200);
    const packetId = sendRes.body.packetId;
    expect(wallet.getBalance(sender.userId)).toBe(0);

    // 模拟注销结算：不满 24h 即把在途红包标 expired 并退回发送者
    const settle = rpService.settleUserActivePacketsTx(sender.userId);
    expect(settle.refundedTotal).toBe(100);
    expect(db.prepare('SELECT status FROM red_packets WHERE id=?').get(packetId).status).toBe('expired');
    expect(wallet.getBalance(sender.userId)).toBe(100); // 剩余已退回发送者

    // 领取者尝试领取 → 应被拒（红包已过期），且不得到账
    const res = await claim(receiver, packetId);
    expect(res.status).toBe(400);
    expect(wallet.getBalance(receiver.userId)).toBe(0);

    // 无领取流水、无领取记录、claimed_count 未变 → 未双花
    const claimTx = db.prepare(
      "SELECT COUNT(*) c FROM wallet_transactions WHERE user_id=? AND type='red_packet_claim' AND ref_id=?"
    ).get(receiver.userId, packetId).c;
    expect(claimTx).toBe(0);
    const claimRow = db.prepare('SELECT COUNT(*) c FROM red_packet_claims WHERE packet_id=?').get(packetId).c;
    expect(claimRow).toBe(0);
    expect(db.prepare('SELECT claimed_count FROM red_packets WHERE id=?').get(packetId).claimed_count).toBe(0);

    // 钱守恒：系统内该红包相关的净额 = 发送者最终余额 100，领取者 0
    expect(wallet.getBalance(sender.userId)).toBe(100);
  });

  test('正常未过期红包仍可正常领取（未误伤）', async () => {
    const sender = await makeUser({ username: 'rpok_sender' });
    const receiver = await makeUser({ username: 'rpok_receiver' });
    await befriend(sender, receiver);
    const conversationId = await privateConversation(sender, receiver);

    wallet.applyDelta(sender.userId, 100, 'test_seed', null, '测试入账');
    const sendRes = await request(app).post('/api/messages/red-packet/send')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ conversationId, totalAmount: 100, totalCount: 1, greeting: '恭喜' });
    const packetId = sendRes.body.packetId;

    const res = await claim(receiver, packetId);
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(100);
    expect(wallet.getBalance(receiver.userId)).toBe(100);
  });
});
