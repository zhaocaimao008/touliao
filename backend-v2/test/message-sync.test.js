'use strict';

const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const { appendConversationEvent } = require('../src/modules/messages/sync.service');
const messageService = require('../src/modules/messages/messages.service');
const walletService = require('../src/modules/wallet/wallet.service');

describe('统一消息同步游标', () => {
  let a;
  let b;
  let convId;

  beforeAll(async () => {
    a = await makeUser({ username: 'sync_a' });
    b = await makeUser({ username: 'sync_b' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
  });

  test('同一会话并发追加事件获得严格递增且唯一的 server_sequence', async () => {
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) =>
      appendConversationEvent({
        conversationId: convId,
        eventType: 'message_created',
        messageId: `sync-seq-${i}`,
        actorId: a.userId,
        payload: { content: String(i) },
      })
    ));
    const seqs = results.map(r => r.server_sequence).sort((x, y) => x - y);
    expect(new Set(seqs).size).toBe(100);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1] + 1);
  });

  test.each([1, 10, 100, 1000, 10000])('cursor 分页可完整恢复 %i 个事件', async count => {
    const isolated = `sync-load-${count}-${Date.now()}`;
    db.prepare('INSERT INTO conversations (id,type,name) VALUES (?,\'private\',\'sync load\')').run(isolated);
    db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(isolated, a.userId);

    const insertEvent = db.prepare(`
      INSERT INTO conversation_events
        (id, conversation_id, server_sequence, event_type, message_id, actor_id, payload)
      VALUES (?, ?, ?, 'message_created', ?, ?, '{}')
    `);
    db.transaction(() => {
      for (let i = 1; i <= count; i++) insertEvent.run(`${isolated}-e-${i}`, isolated, i, `${isolated}-m-${i}`, a.userId);
      db.prepare('INSERT INTO conversation_sequences (conversation_id,last_sequence) VALUES (?,?)').run(isolated, count);
    })();

    let cursor = 0;
    const seen = [];
    do {
      const res = await request(app)
        .get(`/api/messages/${isolated}/sync?cursor=${cursor}&limit=137`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(res.status).toBe(200);
      expect(res.body.next_cursor).toBeGreaterThanOrEqual(cursor);
      seen.push(...res.body.messages.map(e => e.server_sequence));
      cursor = res.body.next_cursor;
      if (!res.body.has_more) break;
    } while (true);

    expect(seen).toHaveLength(count);
    expect(new Set(seen).size).toBe(count);
    expect(cursor).toBe(count);
  }, 30000);

  test('重复拉取同一 cursor 返回相同事件且不产生新数据', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM conversation_events WHERE conversation_id=?').get(convId).n;
    const fetchPage = () => request(app)
      .get(`/api/messages/${convId}/sync?cursor=0&limit=20`)
      .set('Authorization', `Bearer ${a.token}`);
    const [one, two] = await Promise.all([fetchPage(), fetchPage()]);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(two.body).toEqual(one.body);
    expect(db.prepare('SELECT COUNT(*) AS n FROM conversation_events WHERE conversation_id=?').get(convId).n).toBe(before);
  });

  test('个人删除事件只对目标账号可见，但其他设备游标仍推进到高水位', async () => {
    const event = await appendConversationEvent({
      conversationId: convId,
      eventType: 'message_deleted_for_me',
      messageId: 'only-a',
      actorId: a.userId,
      targetUserId: a.userId,
      payload: {},
    });
    const aRes = await request(app).get(`/api/messages/${convId}/sync?cursor=${event.server_sequence - 1}`)
      .set('Authorization', `Bearer ${a.token}`);
    const bRes = await request(app).get(`/api/messages/${convId}/sync?cursor=${event.server_sequence - 1}`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(aRes.body.messages).toHaveLength(1);
    expect(bRes.body.messages).toHaveLength(0);
    expect(bRes.body.next_cursor).toBe(event.server_sequence);
  });

  test('发送、编辑、撤回共用同一严格递增事件流', async () => {
    const start = db.prepare('SELECT COALESCE(MAX(server_sequence),0) AS seq FROM conversation_events WHERE conversation_id=?').get(convId).seq;
    const message = await messageService.send(null, convId, a.userId, { content: 'before edit', type: 'text' });
    await messageService.edit(null, a.userId, message.id, 'after edit');
    await messageService.remove(null, a.userId, message.id, true, false, false);

    const response = await request(app).get(`/api/messages/${convId}/sync?cursor=${start}&limit=20`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(response.status).toBe(200);
    expect(response.body.messages.map(event => event.event_type)).toEqual([
      'message_created', 'message_edited', 'message_recalled',
    ]);
    expect(response.body.messages.map(event => event.server_sequence)).toEqual([start + 1, start + 2, start + 3]);
    expect(response.body.messages[1].payload.content).toBe('after edit');
  });

  test('钱包转账提交后发出同步失效提示', async () => {
    walletService.recharge(a.userId, 10);
    const realIo = app.get('io');
    const hints = [];
    app.set('io', {
      to: () => ({ emit: (event, payload) => hints.push({ event, payload }) }),
    });
    try {
      const result = await walletService.transfer(a.userId, {
        to_user_id: b.userId, amount: 1, note: 'sync hint',
      }, app.get('io'));
      expect(result.message.server_sequence).toBeGreaterThan(0);
      expect(hints).toContainEqual(expect.objectContaining({
        event: 'conversation_sync_available',
        payload: expect.objectContaining({ conversationId: convId, server_sequence: result.message.server_sequence }),
      }));
    } finally {
      app.set('io', realIo);
    }
  });

  test('批量转发返回批次结果并支持 client_batch_id 幂等重试', async () => {
    const source = await messageService.send(null, convId, a.userId, { content: 'forward me', type: 'text' });
    const clientBatchId = `client-batch-${Date.now()}`;
    const first = await request(app).post('/api/messages/forward')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ msgIds: [source.id], conversationIds: [convId], client_batch_id: clientBatchId });
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);
    expect(first.body.batch_id).toBeTruthy();
    expect(first.body.status).toBe('success');
    expect(first.body.total).toBe(1);
    expect(first.body.success_count).toBe(1);
    expect(first.body.failed_count).toBe(0);

    const countAfterFirst = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=? AND batch_id=?')
      .get(convId, first.body.batch_id).n;
    const second = await request(app).post('/api/messages/forward')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ msgIds: [source.id], conversationIds: [convId], client_batch_id: clientBatchId });
    expect(second.status).toBe(200);
    expect(second.body.batch_id).toBe(first.body.batch_id);
    expect(second.body.success_count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=? AND batch_id=?')
      .get(convId, first.body.batch_id).n).toBe(countAfterFirst);
  });

  test('批量转发失败项明确返回且不伪装成全部成功', async () => {
    const valid = await messageService.send(null, convId, a.userId, { content: 'valid', type: 'text' });
    const invalidId = `missing-${Date.now()}`;
    const response = await request(app).post('/api/messages/forward')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ msgIds: [valid.id, invalidId], conversationIds: [convId], client_batch_id: `partial-${Date.now()}` });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('partial_success');
    expect(response.body.total).toBe(2);
    expect(response.body.success_count).toBe(1);
    expect(response.body.failed_count).toBe(1);
    expect(response.body.failed_message_ids).toContain(invalidId);
    expect(response.body.retryable_message_ids).toContain(invalidId);
  });
});
