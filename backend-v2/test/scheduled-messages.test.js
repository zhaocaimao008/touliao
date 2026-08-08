'use strict';
/**
 * 消息定时发送功能测试：
 *   1. POST /api/messages/schedule 创建（校验 15 分钟~30 天区间）
 *   2. GET /api/messages/schedule 列表
 *   3. DELETE /api/messages/schedule/:id 取消（仅本人、仅 pending）
 *   4. 调度器 sendDueMessages 到期发送 → 消息入库带 is_scheduled=1
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const sched = require('../src/modules/messages/scheduled.service');

describe('消息定时发送', () => {
  let u1, u2, convId;

  beforeAll(async () => {
    u1 = await makeUser();
    u2 = await makeUser();
    await befriend(u1, u2);
    convId = await privateConversation(u1, u2);
  });

  const now = () => Math.floor(Date.now() / 1000);

  test('正常创建：返回 pending 定时消息', async () => {
    const res = await request(app)
      .post('/api/messages/schedule')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ conversation_id: convId, content: '一小时后的问候', type: 'text', send_at: now() + 3600 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.scheduled.status).toBe('pending');
    expect(res.body.scheduled.content).toBe('一小时后的问候');
  });

  test('发送时间少于 15 分钟：返回 400', async () => {
    const res = await request(app)
      .post('/api/messages/schedule')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ conversation_id: convId, content: '太快了', send_at: now() + 60 });
    expect(res.status).toBe(400);
  });

  test('发送时间超过 30 天：返回 400', async () => {
    const res = await request(app)
      .post('/api/messages/schedule')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ conversation_id: convId, content: '太久了', send_at: now() + 31 * 24 * 3600 });
    expect(res.status).toBe(400);
  });

  test('非会话成员创建：返回 403', async () => {
    const stranger = await makeUser();
    const res = await request(app)
      .post('/api/messages/schedule')
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ conversation_id: convId, content: '越权', send_at: now() + 3600 });
    expect(res.status).toBe(403);
  });

  test('列表返回本人 pending 定时消息', async () => {
    const res = await request(app)
      .get('/api/messages/schedule')
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(s => s.content === '一小时后的问候')).toBe(true);
  });

  test('取消定时消息：仅本人、仅 pending', async () => {
    const created = await request(app)
      .post('/api/messages/schedule')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ conversation_id: convId, content: '待取消', send_at: now() + 3600 });
    const id = created.body.scheduled.id;

    // 他人不可取消
    const bad = await request(app)
      .delete(`/api/messages/schedule/${id}`)
      .set('Authorization', `Bearer ${u2.token}`);
    expect(bad.status).toBe(403);

    // 本人取消成功
    const ok = await request(app)
      .delete(`/api/messages/schedule/${id}`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);

    // 已取消再取消 → 400
    const again = await request(app)
      .delete(`/api/messages/schedule/${id}`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(again.status).toBe(400);
  });

  test('调度器 sendDueMessages 到期发送：消息入库且 is_scheduled=1', async () => {
    // 直接插一条已到期的 pending（绕过 15 分钟下限，模拟到点）
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    db.prepare(
      'INSERT INTO scheduled_messages (id,conversation_id,sender_id,content,type,send_at,status) VALUES (?,?,?,?,?,?,?)'
    ).run(id, convId, u1.userId, '到点自动发出', 'text', now() - 5, 'pending');

    const sent = await sched.sendDueMessages();
    expect(sent).toBeGreaterThanOrEqual(1);

    // scheduled_messages 状态变 sent
    const row = db.prepare('SELECT status FROM scheduled_messages WHERE id=?').get(id);
    expect(row.status).toBe('sent');

    // messages 表出现该消息，is_scheduled=1
    const msg = db.prepare(
      'SELECT * FROM messages WHERE conversation_id=? AND content=? AND is_scheduled=1'
    ).get(convId, '到点自动发出');
    expect(msg).toBeTruthy();
  });

  test('未到期消息不发送', async () => {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    db.prepare(
      'INSERT INTO scheduled_messages (id,conversation_id,sender_id,content,type,send_at,status) VALUES (?,?,?,?,?,?,?)'
    ).run(id, convId, u1.userId, '未来消息', 'text', now() + 3600, 'pending');

    await sched.sendDueMessages();
    const row = db.prepare('SELECT status FROM scheduled_messages WHERE id=?').get(id);
    expect(row.status).toBe('pending');
  });

  test('未登录返回 401', async () => {
    const res = await request(app)
      .post('/api/messages/schedule')
      .send({ conversation_id: convId, content: 'x', send_at: now() + 3600 });
    expect(res.status).toBe(401);
  });
});
