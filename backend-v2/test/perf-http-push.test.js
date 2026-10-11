'use strict';
/**
 * 回归（2026-10-11，http-push）：绕开 socket handler 的消息创建路径必须发离线推送。
 *
 * 修复前 messages.service.send()（HTTP 发送 / Web 合并转发）、forward()、被表情/分片上传调用的
 * saveUploadedFile()、红包、转账都只「落库 + 广播」，从不调 pushNewMessage——收件人 App 在
 * 后台/被杀时收不到任何通知；只有直传文件的 controller 自己推了一次。
 *
 * 断言：
 *   - HTTP 发送新消息推一次；clientMsgId 去重、并发撞唯一约束回放都不再推
 *   - 转发按目标会话合并：N 条 × M 个会话 → 恰好 M 次推送（每会话取最后一条）
 *   - 直传文件只推一次（推送收口到 saveUploadedFile 后，controller 不能再推一次）
 *   - 表情发送经 saveUploadedFile 同样推送
 *   - 红包/转账新建推一次、Idempotency-Key 回放不推；转账正文不外露原始 JSON
 */
// 只替换 pushNewMessage：好友申请等路径还要用真实的 pushToUser/langOf（无设备令牌时为空操作）
jest.mock('../src/utils/push', () => ({
  ...jest.requireActual('../src/utils/push'),
  pushNewMessage: jest.fn(async () => {}),
}));
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const svc = require('../src/modules/messages/messages.service');
const { pushNewMessage } = require('../src/utils/push');

jest.setTimeout(20000);

// 推送在 setImmediate 里调度（与 socket 路径一致），断言前先让出一轮 check 阶段
const flushImmediate = () => new Promise(resolve => setImmediate(resolve));
const pushed = () => pushNewMessage.mock.calls.map(([payload]) => payload);
const auth = (req, user) => req.set('Authorization', `Bearer ${user.token}`);

describe('非 socket 消息创建路径的离线推送（http-push）', () => {
  let u1, u2, u3, conv12, conv13;

  beforeAll(async () => {
    u1 = await makeUser();
    u2 = await makeUser();
    u3 = await makeUser();
    await befriend(u1, u2);
    await befriend(u1, u3);
    conv12 = await privateConversation(u1, u2);
    conv13 = await privateConversation(u1, u3);
  });

  beforeEach(async () => {
    await flushImmediate();
    pushNewMessage.mockClear();
  });

  test('HTTP 发送：新落库推送一次，载荷字段与 socket send_message 一致', async () => {
    const res = await auth(request(app).post(`/api/messages/${conv12}`), u1)
      .send({ content: 'http 推送回归', type: 'text', clientMsgId: `perf-http-push-${Date.now()}` });
    expect(res.status).toBe(200);
    await flushImmediate();
    expect(pushNewMessage).toHaveBeenCalledTimes(1);
    expect(pushed()[0]).toMatchObject({
      messageId: res.body.id, conversationId: conv12, senderId: u1.userId, senderName: res.body.senderName,
      content: 'http 推送回归', type: 'text', timestamp: res.body.created_at,
    });
  });

  test('HTTP 发送：同 clientMsgId 重发命中去重，不再推送', async () => {
    const body = { content: '去重不推', type: 'text', clientMsgId: `perf-http-dedup-${Date.now()}` };
    const first = await auth(request(app).post(`/api/messages/${conv12}`), u1).send(body);
    expect(first.status).toBe(200);
    await flushImmediate();
    pushNewMessage.mockClear();

    // Web 合并转发/弱网重试会复用同一 clientMsgId：返回已存消息，但不能再通知一次
    const again = await auth(request(app).post(`/api/messages/${conv12}`), u1).send(body);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    await flushImmediate();
    expect(pushNewMessage).not.toHaveBeenCalled();
  });

  test('HTTP 发送：同 clientMsgId 并发（撞唯一约束回放）只落库一次、只推一次', async () => {
    const payload = { content: '并发重发', type: 'text', clientMsgId: `perf-http-race-${Date.now()}` };
    const results = await Promise.allSettled([
      svc.send(null, conv12, u1.userId, payload),
      svc.send(null, conv12, u1.userId, payload),
    ]);
    const ids = results.filter(r => r.status === 'fulfilled').map(r => r.value.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id=? AND client_msg_id=?')
      .get(u1.userId, payload.clientMsgId).n).toBe(1);
    await flushImmediate();
    expect(pushNewMessage).toHaveBeenCalledTimes(1);
    expect(pushed()[0].messageId).toBe(ids[0]);
  });

  test('转发 3 条到 2 个会话：每个目标会话只推一次（该会话最后一条转发消息）', async () => {
    const ids = [];
    for (const content of ['转发一', '转发二', '转发三']) {
      const r = await auth(request(app).post(`/api/messages/${conv12}`), u1).send({ content, type: 'text' });
      expect(r.status).toBe(200);
      ids.push(r.body.id);
    }
    await flushImmediate();
    pushNewMessage.mockClear();

    const res = await auth(request(app).post('/api/messages/forward'), u1)
      .send({ msgIds: ids, conversationIds: [conv12, conv13] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    await flushImmediate();
    // 6 条转发消息只推 2 次：逐条推会在大批量转发时造成通知风暴
    expect(pushNewMessage).toHaveBeenCalledTimes(2);
    expect(pushed().map(p => p.conversationId).sort()).toEqual([conv12, conv13].sort());
    for (const p of pushed()) {
      const last = res.body.target_results.find(t => t.conversation_id === p.conversationId && t.source_message_id === ids[2]);
      expect(p).toMatchObject({ messageId: last.message_id, senderId: u1.userId, type: 'text', content: '转发三' });
    }
  });

  test('直传文件：只推一次（推送已收口到 saveUploadedFile，controller 不再重复推）', async () => {
    const res = await auth(request(app).post(`/api/messages/${conv12}/upload`), u1)
      .attach('file', Buffer.from('perf http push attachment'), { filename: 'perf-push.txt', contentType: 'text/plain' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('file');
    await flushImmediate();
    expect(pushNewMessage).toHaveBeenCalledTimes(1);
    expect(pushed()[0]).toMatchObject({
      messageId: res.body.id, conversationId: conv12, senderId: u1.userId, senderName: res.body.senderName,
      content: res.body.content, type: 'file', timestamp: res.body.created_at,
    });
  });

  test('表情发送（复用 saveUploadedFile）：推送一次', async () => {
    const up = await auth(request(app).post(`/api/messages/${conv12}/upload`), u1)
      .attach('file', Buffer.from('perf sticker source'), { filename: 'perf-sticker.txt', contentType: 'text/plain' });
    expect(up.status).toBe(200);
    const collected = await auth(request(app).post('/api/stickers/collect'), u1).send({ url: up.body.file_url });
    expect(collected.status).toBe(200);
    await flushImmediate();
    pushNewMessage.mockClear();

    const sent = await auth(request(app).post('/api/stickers/send'), u1)
      .send({ stickerId: collected.body.id, conversationId: conv13 });
    expect(sent.status).toBe(200);
    await flushImmediate();
    expect(pushNewMessage).toHaveBeenCalledTimes(1);
    expect(pushed()[0]).toMatchObject({
      messageId: sent.body.id, conversationId: conv13, senderId: u1.userId, type: 'image', content: '[表情]',
    });
  });

  test('红包 / 转账：新建推一次，Idempotency-Key 回放不推；转账正文不外露 JSON', async () => {
    const recharged = await auth(request(app).post('/api/wallet/recharge'), u1).send({ amount: 1000 });
    expect(recharged.status).toBe(200);

    const packetKey = `perf-push-packet-${Date.now()}`;
    const sendPacket = () => auth(request(app).post('/api/redpackets/send'), u1).set('Idempotency-Key', packetKey)
      .send({ conversationId: conv12, totalAmount: 10, totalCount: 1, greeting: '推送回归' });
    const packet = await sendPacket();
    expect(packet.status).toBe(200);
    await flushImmediate();
    expect(pushNewMessage).toHaveBeenCalledTimes(1);
    expect(pushed()[0]).toMatchObject({
      messageId: packet.body.message.id, conversationId: conv12, senderId: u1.userId, type: 'red_packet',
    });
    const packetReplay = await sendPacket();
    expect(packetReplay.status).toBe(200);
    expect(packetReplay.body.message.id).toBe(packet.body.message.id);
    await flushImmediate();
    expect(pushNewMessage).toHaveBeenCalledTimes(1);

    pushNewMessage.mockClear();
    const transferKey = `perf-push-transfer-${Date.now()}`;
    const sendTransfer = () => auth(request(app).post('/api/wallet/transfer'), u1).set('Idempotency-Key', transferKey)
      .send({ to_user_id: u2.userId, amount: 10, note: '推送回归' });
    const transfer = await sendTransfer();
    expect(transfer.status).toBe(200);
    await flushImmediate();
    expect(pushNewMessage).toHaveBeenCalledTimes(1);
    // pushI18n 无 transfer 占位，content 会原样成为通知正文：不能是 {"amount":..} 这串 JSON
    expect(pushed()[0]).toMatchObject({
      messageId: transfer.body.message.id, conversationId: conv12, senderId: u1.userId, type: 'transfer', content: '[转账]',
    });
    const transferReplay = await sendTransfer();
    expect(transferReplay.status).toBe(200);
    expect(transferReplay.body.message.id).toBe(transfer.body.message.id);
    await flushImmediate();
    expect(pushNewMessage).toHaveBeenCalledTimes(1);
  });
});
