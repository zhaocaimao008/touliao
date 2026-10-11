'use strict';
/**
 * 聊天文件聚合视图：GET /api/messages/conversation/:convId/files
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const { v4: uuid } = require('uuid');

describe('聊天文件聚合视图', () => {
  let u1, u2, convId;

  beforeAll(async () => {
    u1 = await makeUser();
    u2 = await makeUser();
    await befriend(u1, u2);
    convId = await privateConversation(u1, u2);

    const now = Math.floor(Date.now() / 1000);
    const insert = db.prepare(
      'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,created_at) VALUES (?,?,?,?,?,?,?)'
    );
    insert.run(uuid(), convId, u1.userId, 'image',  '照片.jpg',  '/uploads/files/a.jpg',  now);
    insert.run(uuid(), convId, u2.userId, 'video',  '视频.mp4',  '/uploads/files/b.mp4',  now + 1);
    insert.run(uuid(), convId, u1.userId, 'file',   '文档.pdf',  '/uploads/files/c.pdf',  now + 2);
    db.prepare('UPDATE messages SET file_mime=?, file_size=? WHERE conversation_id=? AND file_url=?')
      .run('application/pdf', 0, convId, '/uploads/files/c.pdf');
    insert.run(uuid(), convId, u1.userId, 'text',   '普通消息',   '',                       now + 3);
    // 已删除的文件不应返回
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,deleted,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(uuid(), convId, u1.userId, 'image', '删除图.jpg', '/uploads/files/del.jpg', 1, now + 4);
    db.prepare('INSERT INTO conversation_settings (conversation_id,user_id,burn_after) VALUES (?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET burn_after=excluded.burn_after')
      .run(convId,u1.userId,30);
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,burn_after,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(uuid(), convId, u1.userId, 'image', '阅后即焚.jpg', '/uploads/files/ephemeral.jpg', 30, now + 5);
    db.prepare('UPDATE conversation_settings SET burn_after=0 WHERE conversation_id=? AND user_id=?').run(convId,u1.userId);
  });

  test('全部类型：返回 image/video/file，排除 text 和已删消息', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/files?type=all`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(200);
    const { items, total } = res.body;
    expect(total).toBe(3);
    expect(items.length).toBe(3);
    // 按时间倒序
    const types = items.map(i => i.type);
    expect(types).toContain('image');
    expect(types).toContain('video');
    expect(types).toContain('file');
    expect(types).not.toContain('text');
  });

  test('按 type=image 筛选：只返回图片', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/files?type=image`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(200);
    const { items, total } = res.body;
    expect(total).toBe(1);
    expect(items[0].type).toBe('image');
    expect(items[0].fileName).toBe('照片.jpg');
    expect(items[0].fileUrl).toMatch(/\.jpg/);
    expect(items[0].senderName).toBeDefined();
  });

  test('按 type=video 筛选：只返回视频', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/files?type=video`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].type).toBe('video');
  });

  test('按 type=file 筛选：只返回普通文件', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/files?type=file`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].type).toBe('file');
    expect(res.body.items[0].fileMime).toBe('application/pdf');
    expect(res.body.items[0].fileSize).toBe(0);
  });

  test('分页：limit=1 只返回一条，offset 分页正确', async () => {
    const p1 = await request(app)
      .get(`/api/messages/conversation/${convId}/files?type=all&limit=1&offset=0`)
      .set('Authorization', `Bearer ${u1.token}`);
    const p2 = await request(app)
      .get(`/api/messages/conversation/${convId}/files?type=all&limit=1&offset=1`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(p1.body.items.length).toBe(1);
    expect(p2.body.items.length).toBe(1);
    expect(p1.body.items[0].id).not.toBe(p2.body.items[0].id);
  });

  test('非会话成员：返回 403', async () => {
    const stranger = await makeUser();
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/files`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(res.status).toBe(403);
  });

  test('未登录：返回 401', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/files`);
    expect(res.status).toBe(401);
  });

  test('个人删除的附件及计数仅对当前用户隐藏', async () => {
    const { id } = db.prepare('SELECT id FROM messages WHERE conversation_id=? AND file_url=?').get(convId, '/uploads/files/c.pdf');
    db.prepare('INSERT INTO user_message_deletions (message_id,user_id) VALUES (?,?)').run(id,u1.userId);
    try {
      const mine = await request(app).get(`/api/messages/conversation/${convId}/files`).set('Authorization', `Bearer ${u1.token}`);
      const other = await request(app).get(`/api/messages/conversation/${convId}/files`).set('Authorization', `Bearer ${u2.token}`);
      expect(mine.status).toBe(200); expect(mine.body.total).toBe(2); expect(mine.body.items.some(item=>item.id===id)).toBe(false);
      expect(other.body.total).toBe(3); expect(other.body.items.some(item=>item.id===id)).toBe(true);
    } finally { db.prepare('DELETE FROM user_message_deletions WHERE message_id=? AND user_id=?').run(id,u1.userId); }
  });

  test('清空聊天后文件列表和计数遵守个人清空边界', async () => {
    const { cutoff } = db.prepare('SELECT MAX(rowid) AS cutoff FROM messages WHERE conversation_id=?').get(convId);
    db.prepare('INSERT INTO conversation_clears (user_id,conversation_id,cleared_at,cleared_rowid) VALUES (?,?,?,?)').run(u1.userId,convId,Math.floor(Date.now()/1000),cutoff);
    try {
      const mine = await request(app).get(`/api/messages/conversation/${convId}/files`).set('Authorization', `Bearer ${u1.token}`);
      const other = await request(app).get(`/api/messages/conversation/${convId}/files`).set('Authorization', `Bearer ${u2.token}`);
      expect(mine.status).toBe(200); expect(mine.body).toMatchObject({total:0,items:[]}); expect(other.body.total).toBe(3);
    } finally { db.prepare('DELETE FROM conversation_clears WHERE user_id=? AND conversation_id=?').run(u1.userId,convId); }
  });
});
