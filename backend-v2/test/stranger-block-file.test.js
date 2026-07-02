'use strict';
/**
 * 回归：屏蔽陌生人消息（block_unknown_messages）必须同时拦截文本与文件/图片。
 *
 * round43 前的漏洞：文本发送(HTTP/socket)有屏蔽陌生人校验，但文件上传路径
 * saveUploadedFile 缺失该校验——曾是好友的双方在一方删除好友并开启"屏蔽陌生人"后，
 * 另一方仍能经既有私聊会话用图片/文件绕过设置继续骚扰。
 * round44 补齐：云存储 socket 文件路径(send_file_message) 与 转发(forward) 同样拦截。
 *
 * 场景：u1、u2 先加好友建私聊 → u2 开启屏蔽陌生人 → u1 删除好友(双向解除) →
 * u1 再发消息时对 u2 而言已是"陌生人"，文本与文件都应被 403 拒绝、转发被静默跳过。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');

// 1x1 透明 PNG（真实魔数，可通过 magic bytes 校验）
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('屏蔽陌生人消息：文本与文件一致拦截（round43 回归）', () => {
  let u1, u2, conversationId, seedMsgId;

  beforeAll(async () => {
    u1 = await makeUser({ username: 'sbf_user1' });
    u2 = await makeUser({ username: 'sbf_user2' });
    await befriend(u1, u2);
    conversationId = await privateConversation(u1, u2);

    // 好友期间先发一条消息，留作后续"陌生人转发"用例的转发源
    const seed = await request(app).post(`/api/messages/${conversationId}`)
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ content: '好友期间的消息', type: 'text' });
    expect(seed.status).toBe(200);
    seedMsgId = seed.body.id;

    // u2 开启屏蔽陌生人消息
    const s = await request(app).put('/api/users/me/settings')
      .set('Authorization', `Bearer ${u2.token}`)
      .send({ blockUnknownMessages: true });
    expect(s.status).toBe(200);

    // u1 删除 u2 好友（deleteContact 双向解除）——此后 u1 对 u2 而言是陌生人，会话仍在
    const del = await request(app).delete(`/api/users/contacts/${u2.userId}`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(del.status).toBe(200);
  });

  test('陌生人发文本被拒（403）', async () => {
    const res = await request(app).post(`/api/messages/${conversationId}`)
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ content: '在既有会话骚扰', type: 'text' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/屏蔽陌生人/);
  });

  test('陌生人发文件同样被拒（403，round43 前会 200）', async () => {
    const res = await request(app).post(`/api/messages/${conversationId}/upload`)
      .set('Authorization', `Bearer ${u1.token}`)
      .attach('file', PNG_1x1, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/屏蔽陌生人/);
  });

  test('陌生人转发被静默跳过（sent=0，round44）', async () => {
    const res = await request(app).post('/api/messages/forward')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ msgId: seedMsgId, conversationIds: [conversationId] });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(0);
  });

  test('重新加好友后文件恢复可发（200）', async () => {
    await befriend(u1, u2);
    const res = await request(app).post(`/api/messages/${conversationId}/upload`)
      .set('Authorization', `Bearer ${u1.token}`)
      .attach('file', PNG_1x1, { filename: 'y.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('image');
  });
});
