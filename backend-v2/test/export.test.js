'use strict';
/**
 * 聊天记录导出功能测试：GET /api/messages/conversation/:convId/export
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser, befriend, privateConversation } = require('./helpers');

describe('聊天记录导出', () => {
  let u1, u2, convId;

  beforeAll(async () => {
    u1 = await makeUser();
    u2 = await makeUser();
    await befriend(u1, u2);
    convId = await privateConversation(u1, u2);

    // 发几条消息
    await request(app)
      .post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ type: 'text', content: '你好，这是第一条消息' });
    await request(app)
      .post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${u2.token}`)
      .send({ type: 'text', content: '收到，这是回复' });
    await request(app)
      .post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ type: 'text', content: '测试导出功能！' });
  });

  test('正常导出：返回 text/plain 且包含消息内容', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/export`)
      .set('Authorization', `Bearer ${u1.token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    const text = res.text;
    expect(text).toContain('你好，这是第一条消息');
    expect(text).toContain('收到，这是回复');
    expect(text).toContain('测试导出功能！');
    // 格式验证：含发送者昵称
    expect(text).toContain(u1.username);
    expect(text).toContain(u2.username);
  });

  test('导出内容是 UTF-8 可读文本，无乱码', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/export`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(200);
    // 验证含中文字符（Buffer 解码无乱码）
    const buf = Buffer.from(res.text, 'utf-8');
    expect(buf.toString('utf-8')).toContain('你好');
  });

  test('响应头包含 Content-Disposition（下载文件名）', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/export`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/\.txt/);
  });

  test('非会话成员无法导出：返回 403', async () => {
    const stranger = await makeUser();
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/export`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(res.status).toBe(403);
  });

  test('未登录时返回 401', async () => {
    const res = await request(app)
      .get(`/api/messages/conversation/${convId}/export`);
    expect(res.status).toBe(401);
  });

  test('会话 ID 不存在时返回 403', async () => {
    const res = await request(app)
      .get('/api/messages/conversation/nonexistent-conv-id/export')
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(403);
  });
});
