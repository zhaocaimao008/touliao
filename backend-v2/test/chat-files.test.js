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
    insert.run(uuid(), convId, u1.userId, 'text',   '普通消息',   '',                       now + 3);
    // 已删除的文件不应返回
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,deleted,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(uuid(), convId, u1.userId, 'image', '删除图.jpg', '/uploads/files/del.jpg', 1, now + 4);
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
});
