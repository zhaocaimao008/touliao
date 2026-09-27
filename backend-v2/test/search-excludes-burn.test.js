'use strict';
/**
 * 阅后即焚消息不进任何搜索：否则接收方不点开、直接搜关键词即可读到内容，且不触发销毁倒计时。
 * 覆盖客户端在用的 /api/messages/search、会话内搜索，以及旧的 /api/search/*（另外补上「仅自己删除」过滤）。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const { v4: uuidv4 } = require('uuid');

// 与生产一致：发送者在该会话开启阅后即焚 → 插入触发器 messages_capture_burn_policy 写入 burn_after
function insertMsg(convId, senderId, content, burnAfter = 0) {
  db.prepare('INSERT INTO conversation_settings (conversation_id,user_id,burn_after) VALUES (?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET burn_after=excluded.burn_after')
    .run(convId, senderId, burnAfter);
  const id = uuidv4();
  db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, convId, senderId, 'text', content, Math.floor(Date.now() / 1000));
  return id;
}
const get = (u, path) => request(app).get(path).set('Authorization', `Bearer ${u.token}`);
const ids = body => JSON.stringify(body);

describe('搜索排除阅后即焚与仅自己删除的消息', () => {
  let a, b, convId, burnId, normalId, deletedForMeId;
  beforeAll(async () => {
    a = await makeUser({ username: 'sb_a' });
    b = await makeUser({ username: 'sb_b' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
    burnId = insertMsg(convId, a.userId, '机密暗号焚毁甲', 30);
    normalId = insertMsg(convId, a.userId, '机密暗号普通乙');
    deletedForMeId = insertMsg(convId, a.userId, '机密暗号删除丙');
    db.prepare('INSERT INTO user_message_deletions (message_id, user_id) VALUES (?, ?)').run(deletedForMeId, b.userId);
  });

  test('全局搜索（客户端在用）', async () => {
    const res = await get(b, `/api/messages/search?q=${encodeURIComponent('机密暗号')}`);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toContain(normalId);
    expect(ids(res.body)).not.toContain(burnId);
  });

  test('会话内搜索（客户端在用）', async () => {
    const res = await get(b, `/api/messages/conversation/${convId}/search?q=${encodeURIComponent('机密暗号')}`);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toContain(normalId);
    expect(ids(res.body)).not.toContain(burnId);
  });

  test('旧 /api/search 接口同样排除阅后即焚与仅自己删除', async () => {
    const inConv = await get(b, `/api/search/messages?conversationId=${convId}&q=${encodeURIComponent('机密暗号')}`);
    const global = await get(b, `/api/search/global?q=${encodeURIComponent('机密暗号')}`);
    for (const res of [inConv, global]) {
      expect(res.status).toBe(200);
      expect(ids(res.body)).not.toContain(burnId);
      expect(ids(res.body)).not.toContain(deletedForMeId);
    }
  });

  test('会话列表预览不透出阅后即焚原文', async () => {
    insertMsg(convId, a.userId, '最后一条焚毁丁', 30);
    const res = await get(b, '/api/messages/conversations');
    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : (res.body.items || res.body.conversations || []);
    const conv = list.find(c => c.id === convId);
    expect(conv.lastMessage).toBe('[阅后即焚消息]');
    expect(JSON.stringify(res.body)).not.toContain('最后一条焚毁丁');
  });
});
