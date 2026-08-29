'use strict';
/**
 * 回归（2026-08-29 iOS→Android视频/语音跨端播放修复）：真机实测发现 iOS 视频上传
 * 产生了 0 字节附件——数据库正常建了video类型消息，但物理文件大小为0，Android端播放器
 * 打开后黑屏卡在 00:00/00:00。根因在iOS客户端的流式上传拼装逻辑(已修)，这里补一道
 * 服务端兜底：不管哪个端/哪次回归再触发类似bug，0字节文件都不应该能建出一条消息。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');

describe('上传0字节文件必须被拒绝，不能建出无法播放的消息', () => {
  let u1, u2, conversationId;

  beforeAll(async () => {
    u1 = await makeUser({ username: 'uzb_user1' });
    u2 = await makeUser({ username: 'uzb_user2' });
    await befriend(u1, u2);
    conversationId = await privateConversation(u1, u2);
  });

  test('0字节视频上传返回400，不产生消息记录', async () => {
    const res = await request(app)
      .post(`/api/messages/${conversationId}/upload`)
      .set('Authorization', `Bearer ${u1.token}`)
      .attach('file', Buffer.alloc(0), { filename: 'empty.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(400);

    const list = await request(app)
      .get(`/api/messages/${conversationId}`)
      .set('Authorization', `Bearer ${u1.token}`);
    const msgs = Array.isArray(list.body) ? list.body : (list.body.messages || []);
    expect(msgs.some(m => m.type === 'video')).toBe(false);
  });

  test('正常非空视频上传仍然成功(对照组，确认修复没有误伤正常上传)', async () => {
    // 最小合法mp4头部字节(仅用于通过"非空"校验，不追求真实可播放，本用例只测服务端字节数校验这一层)
    const fakeMp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const res = await request(app)
      .post(`/api/messages/${conversationId}/upload`)
      .set('Authorization', `Bearer ${u1.token}`)
      .attach('file', fakeMp4, { filename: 'real.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('video');
  });
});
