'use strict';
/**
 * @我消息聚合入口：GET /api/messages/mentions/me
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
const { v4: uuid } = require('uuid');

// 建一个群会话，把给定用户都拉进去，返回 convId
function makeGroup(name, ownerId, memberIds) {
  const convId = uuid();
  db.prepare("INSERT INTO conversations (id,type,name,owner_id) VALUES (?,?,?,?)").run(convId, 'group', name, ownerId);
  const insMember = db.prepare("INSERT OR IGNORE INTO conversation_members (conversation_id,user_id,role) VALUES (?,?,?)");
  insMember.run(convId, ownerId, 'owner');
  for (const uid of memberIds) insMember.run(convId, uid, 'member');
  return convId;
}

describe('@我消息聚合', () => {
  let me, sender, other, convId;

  beforeAll(async () => {
    me = await makeUser();
    sender = await makeUser();
    other = await makeUser();
    convId = makeGroup('测试群', sender.userId, [me.userId, other.userId]);

    const now = Math.floor(Date.now() / 1000);
    const insert = db.prepare(
      'INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)'
    );
    // sender @我
    insert.run(uuid(), convId, sender.userId, 'text', `@${me.username} 你看下这个`, now);
    // sender @别人（不应出现在我的列表）
    insert.run(uuid(), convId, sender.userId, 'text', `@${other.username} 你也看下`, now + 1);
    // 普通消息（无 @）
    insert.run(uuid(), convId, sender.userId, 'text', '大家好', now + 2);
    // 我自己发的 @我（不应出现，排除自己）
    insert.run(uuid(), convId, me.userId, 'text', `@${me.username} 自言自语`, now + 3);
    // 又一条 @我
    insert.run(uuid(), convId, other.userId, 'text', `快看 @${me.username}`, now + 4);
  });

  test('返回所有 @我 的消息（排除自己发的、排除 @别人的）', async () => {
    const res = await request(app)
      .get('/api/messages/mentions/me')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    const { items, total } = res.body;
    expect(total).toBe(2);
    expect(items.length).toBe(2);
    // 含会话信息 + 发送者 + 内容摘要
    for (const it of items) {
      expect(it.convId).toBe(convId);
      expect(it.convName).toBe('测试群');
      expect(it.senderName).toBeDefined();
      expect(it.msgId).toBeDefined();
      expect(it.content).toMatch(new RegExp(`@${me.username}`));
    }
    // 倒序：最新的 other 那条在前
    expect(items[0].senderName).toBe(other.username);
  });

  test('分页 limit/offset 生效', async () => {
    const p1 = await request(app)
      .get('/api/messages/mentions/me?limit=1&offset=0')
      .set('Authorization', `Bearer ${me.token}`);
    const p2 = await request(app)
      .get('/api/messages/mentions/me?limit=1&offset=1')
      .set('Authorization', `Bearer ${me.token}`);
    expect(p1.body.items.length).toBe(1);
    expect(p2.body.items.length).toBe(1);
    expect(p1.body.items[0].msgId).not.toBe(p2.body.items[0].msgId);
  });

  test('无人 @我：返回空列表', async () => {
    const lonely = await makeUser();
    const res = await request(app)
      .get('/api/messages/mentions/me')
      .set('Authorization', `Bearer ${lonely.token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  test('未登录：返回 401', async () => {
    const res = await request(app).get('/api/messages/mentions/me');
    expect(res.status).toBe(401);
  });
});
