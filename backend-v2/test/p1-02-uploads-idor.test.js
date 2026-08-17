'use strict';
/**
 * P1-02 /uploads 越权访问（IDOR）回归测试
 *
 * 修复前：/uploads 只验 JWT 有效性，不验所有权 → 任意有效 JWT 可读取
 * 他人私聊附件/私密朋友圈图片/会话背景；且 nginx 曾直接 alias 静态服务
 * 完全绕过 JWT 鉴权。修复后：按资源类别校验（附件→会话成员；朋友圈→
 * 可见性门控；背景→会话成员；chunks→禁止静态访问；头像→登录可见）。
 */
require('./testEnv');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const config = require('../src/config');
const { app, makeUser, befriend, privateConversation } = require('./helpers');

// 1x1 透明 PNG（真实魔数，可通过 magic bytes 校验）
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('P1-02 /uploads 越权访问（IDOR）', () => {
  let a, b, c, convId, fileUrl, filePath, momentId, momentUrl;

  beforeAll(async () => {
    a = await makeUser({ username: 'p102_a' });
    b = await makeUser({ username: 'p102_b' });
    c = await makeUser({ username: 'p102_c' });
    await befriend(a, b);
    convId = await privateConversation(a, b);

    // A 向私聊会话上传一张真实图片
    const up = await request(app)
      .post(`/api/messages/${convId}/upload`)
      .set('Authorization', `Bearer ${a.token}`)
      .attach('file', PNG_1x1, { filename: 'secret.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    fileUrl = up.body.file_url; // /uploads/files/<uuid>.png
    filePath = path.join(config.uploadsRoot, fileUrl.replace(/^\/uploads\//, ''));
    expect(fs.existsSync(filePath)).toBe(true);

    // A 发一条私密朋友圈（带图），验证图片访问门控
    const mom = await request(app)
      .post('/api/moments')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ content: '私密动态', images: [fileUrl], visibility: 'private' });
    expect(mom.status).toBe(200);
    momentId = mom.body.id;
    momentUrl = fileUrl; // 复用同一张图，验证 moments 门控独立生效
  });

  afterAll(() => {
    try { fs.unlinkSync(filePath); } catch { /* 忽略 */ }
  });

  test('未登录访问 /uploads → 401', async () => {
    const res = await request(app).get(fileUrl);
    expect(res.status).toBe(401);
  });

  test('会话成员 A 访问自己的私聊附件 → 200', async () => {
    const res = await request(app)
      .get(fileUrl)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
  });

  test('会话成员 B 访问同会话附件 → 200', async () => {
    const res = await request(app)
      .get(fileUrl)
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(200);
  });

  test('非会话成员 C 访问 A/B 私聊附件 → 403', async () => {
    const res = await request(app)
      .get(fileUrl)
      .set('Authorization', `Bearer ${c.token}`);
    expect([403, 404]).toContain(res.status);
  });

  test('C 退出群后访问群附件 → 按产品规则拒绝', async () => {
    // 建群，A 拉 C 入群 → C 上传文件 → C 退群 → C 再访问应 403
    await befriend(a, c);
    const grp = await request(app)
      .post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'P1-02 群', memberIds: [c.userId] });
    expect(grp.status).toBe(200);
    const gid = grp.body.conversationId;

    const up = await request(app)
      .post(`/api/messages/${gid}/upload`)
      .set('Authorization', `Bearer ${c.token}`)
      .attach('file', PNG_1x1, { filename: 'group.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    const gUrl = up.body.file_url;
    const gPath = path.join(config.uploadsRoot, gUrl.replace(/^\/uploads\//, ''));
    expect(fs.existsSync(gPath)).toBe(true);

    // 成员时可访问
    const asMember = await request(app).get(gUrl).set('Authorization', `Bearer ${c.token}`);
    expect(asMember.status).toBe(200);

    // C 退群
    const leave = await request(app)
      .post(`/api/messages/conversation/${gid}/leave`)
      .set('Authorization', `Bearer ${c.token}`);
    expect([200, 201]).toContain(leave.status);

    // 退群后访问 → 403/404
    const afterLeave = await request(app).get(gUrl).set('Authorization', `Bearer ${c.token}`);
    expect([403, 404]).toContain(afterLeave.status);

    try { fs.unlinkSync(gPath); } catch { /* 忽略 */ }
  });

  test('私密朋友圈图片：作者可看、非好友不可看（moments 门控）', async () => {
    const authorView = await request(app).get(momentUrl).set('Authorization', `Bearer ${a.token}`);
    expect(authorView.status).toBe(200);

    // c 与 a 非好友 → 无权
    const outsider = await request(app).get(momentUrl).set('Authorization', `Bearer ${c.token}`);
    expect([403, 404]).toContain(outsider.status);
  });

  test('chunks 分片临时文件禁止静态访问 → 403/404', async () => {
    const res = await request(app)
      .get('/uploads/chunks/whatever.part')
      .set('Authorization', `Bearer ${a.token}`);
    expect([403, 404]).toContain(res.status);
  });

  test('未知资源路径 → 404', async () => {
    const res = await request(app)
      .get('/uploads/no-such-category/x.png')
      .set('Authorization', `Bearer ${a.token}`);
    expect([404]).toContain(res.status);
  });

  test('伪造/无效 token → 401', async () => {
    const res = await request(app)
      .get(fileUrl)
      .set('Authorization', 'Bearer forged.token.value');
    expect(res.status).toBe(401);
  });
});
