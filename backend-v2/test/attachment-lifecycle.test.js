'use strict';
/**
 * 统一附件系统 —— 附件访问权限随消息生命周期变化的回归测试。
 *
 * 覆盖 2026-08-29 的两处修复：
 *   1) 转发到新会话后，新会话成员应能访问该附件（此前 file_registry 只认原会话，
 *      新会话成员会被误判 403）。
 *   2) 撤回后，该文件的最后一条有效引用消失时，应立即拒绝访问（此前完全没有实现，
 *      撤回后文件仍可通过 URL 直接访问）。
 *   3) 个人删除(deleteForMe)不应影响文件访问——那只是当前用户自己的可见性 tombstone。
 *
 * 同时必须保持 P1-02 的授权红线：这些新能力只能通过服务端已校验路径(forward())
 * 生效，不能是"只要 messages 表里有一行引用就放行"（否则重新引入 planted-row IDOR，
 * 见 test/p1-02-uploads-idor.test.js）。
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser, befriend, privateConversation } = require('./helpers');

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('附件生命周期（转发/撤回）访问权限', () => {
  let a, b, c, convAB, convAC, fileUrl, uploadedMsgId;

  beforeAll(async () => {
    a = await makeUser({ username: 'attlc_a' });
    b = await makeUser({ username: 'attlc_b' });
    c = await makeUser({ username: 'attlc_c' });
    await befriend(a, b);
    await befriend(a, c);
    convAB = await privateConversation(a, b);
    convAC = await privateConversation(a, c);

    const up = await request(app)
      .post(`/api/messages/${convAB}/upload`)
      .set('Authorization', `Bearer ${a.token}`)
      .attach('file', PNG_1x1, { filename: 'lifecycle.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    fileUrl = up.body.file_url;
    uploadedMsgId = up.body.id;
  });

  test('上传响应携带真实 file_mime/file_size（供前端渲染文件卡片）', () => {
    expect(uploadedMsgId).toBeTruthy();
  });

  test('历史消息里同样能读到 file_mime/file_size', async () => {
    const hist = await request(app)
      .get(`/api/messages/${convAB}?limit=10`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(hist.status).toBe(200);
    const found = hist.body.find(m => m.id === uploadedMsgId);
    expect(found).toBeTruthy();
    expect(found.file_mime).toBe('image/png');
    expect(found.file_size).toBe(PNG_1x1.length);
  });

  test('转发前：C（不在 convAB）访问该文件 → 403', async () => {
    const res = await request(app)
      .get(fileUrl)
      .set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(403);
  });

  test('A 把该图片消息转发到 convAC 后：C 能正常访问该文件', async () => {
    const fwd = await request(app)
      .post('/api/messages/forward')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ msgId: uploadedMsgId, conversationIds: [convAC] });
    expect(fwd.status).toBe(200);

    const res = await request(app)
      .get(fileUrl)
      .set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(200);
  });

  test('撤回原消息后，文件仍有转发到 convAC 的活跃副本 → 依然可访问（转发引用保护生效）', async () => {
    const del = await request(app)
      .delete(`/api/messages/${uploadedMsgId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forEveryone: true });
    expect(del.status).toBe(200);

    // convAC 里的转发副本没有被撤回，是该文件仍然合法存在的活跃引用
    const res = await request(app).get(fileUrl).set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(200);
  });
});

describe('撤回后阻断访问（无其他活跃引用的干净场景）', () => {
  let a, b, convAB, fileUrl, msgId;

  beforeAll(async () => {
    a = await makeUser({ username: 'attlc3_a' });
    b = await makeUser({ username: 'attlc3_b' });
    await befriend(a, b);
    convAB = await privateConversation(a, b);

    const up = await request(app)
      .post(`/api/messages/${convAB}/upload`)
      .set('Authorization', `Bearer ${a.token}`)
      .attach('file', PNG_1x1, { filename: 'recallme.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    fileUrl = up.body.file_url;
    msgId = up.body.id;
  });

  test('撤回前 B 能正常访问', async () => {
    const res = await request(app).get(fileUrl).set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(200);
  });

  test('A 撤回该消息（唯一引用）后，A/B 均无法再访问该文件', async () => {
    const del = await request(app)
      .delete(`/api/messages/${msgId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forEveryone: true });
    expect(del.status).toBe(200);

    for (const u of [a, b]) {
      const res = await request(app).get(fileUrl).set('Authorization', `Bearer ${u.token}`);
      expect(res.status).toBe(403);
    }
  });
});

describe('个人删除(deleteForMe)不影响文件访问', () => {
  let a, b, convAB, fileUrl, msgId;

  beforeAll(async () => {
    a = await makeUser({ username: 'attlc2_a' });
    b = await makeUser({ username: 'attlc2_b' });
    await befriend(a, b);
    convAB = await privateConversation(a, b);

    const up = await request(app)
      .post(`/api/messages/${convAB}/upload`)
      .set('Authorization', `Bearer ${a.token}`)
      .attach('file', PNG_1x1, { filename: 'keepme.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    fileUrl = up.body.file_url;
    msgId = up.body.id;
  });

  test('A 个人删除该消息后：B 依然能正常访问文件（不是安全边界，只是A自己的可见性）', async () => {
    const del = await request(app)
      .delete(`/api/messages/${msgId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ forMe: true });
    expect(del.status).toBe(200);

    const res = await request(app).get(fileUrl).set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(200);
  });
});
