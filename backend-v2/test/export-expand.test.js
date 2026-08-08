'use strict';
/**
 * 聊天记录导出 transfer/red_packet 内容展开测试。
 * 验证修复：导出时转账展开金额+备注，红包展开祝福语，不再输出占位 [转账]/[红包]。
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const { v4: uuid } = require('uuid');

describe('导出 transfer/red_packet 内容展开', () => {
  let u1, u2, convId;

  beforeAll(async () => {
    u1 = await makeUser();
    u2 = await makeUser();
    await befriend(u1, u2);
    convId = await privateConversation(u1, u2);

    const now = Math.floor(Date.now() / 1000);
    // 直接向 messages 表插入 transfer 和 red_packet 消息（绕过钱包/红包业务逻辑）
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)')
      .run(uuid(), convId, u1.userId, 'transfer',
        JSON.stringify({ amount: 200, note: '请客吃饭' }), now);
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)')
      .run(uuid(), convId, u1.userId, 'transfer',
        JSON.stringify({ amount: 50 }), now + 1);  // 无备注
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)')
      .run(uuid(), convId, u1.userId, 'red_packet',
        JSON.stringify({ packetId: 'x1', greeting: '恭喜发财', totalCount: 3, totalAmount: 30 }), now + 2);
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)')
      .run(uuid(), convId, u1.userId, 'red_packet',
        JSON.stringify({ packetId: 'x2', greeting: '', totalCount: 1, totalAmount: 10 }), now + 3);  // 空祝福
  });

  test('transfer 有备注：导出展开金额和备注', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/export`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('[转账] 200 金币 备注:请客吃饭');
  });

  test('transfer 无备注：只展开金额，无备注字段', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/export`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.text).toContain('[转账] 50 金币');
    expect(res.text).not.toMatch(/\[转账\] 50 金币 备注/);
  });

  test('red_packet 有祝福语：导出展开祝福语', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/export`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.text).toContain('[红包] 恭喜发财');
  });

  test('红包空祝福语：仅输出 [红包]', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/export`)
      .set('Authorization', `Bearer ${u1.token}`);
    // 不应输出纯占位 `[红包]` 后紧接空格，但 `[红包]\n` 是允许的
    expect(res.text).toContain('[红包]');
  });

  test('导出不再出现纯 [转账] 占位（已展开）', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/export`)
      .set('Authorization', `Bearer ${u1.token}`);
    // 旧行为：只有 '[转账]'，新行为：至少 '[转账] 数字 金币'
    const lines = res.text.split('\n');
    const transferLines = lines.filter(l => l.trim() === '[转账]');
    expect(transferLines.length).toBe(0);  // 不应存在纯占位行
  });
});
