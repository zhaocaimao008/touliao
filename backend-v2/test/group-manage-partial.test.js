'use strict';
/**
 * 回归：群管理开关局部更新——改一个开关不应影响其它开关。
 *
 * 背景：manage() 以 `body[k] !== undefined` 判定，客户端只传要改的字段。
 * 若客户端把未改字段序列化成 JSON null（Android kotlinx explicitNulls 默认坑），
 * 后端会把 null 当 false → 开「全员禁言」会连带关掉「禁止私聊/禁止互加」。
 * 本测试锁定正确的局部更新语义。
 */
const { request, app, makeUser } = require('./helpers');

describe('群管理开关局部更新', () => {
  let owner, convId;
  beforeAll(async () => {
    const ts = Date.now().toString().slice(-8);
    owner = await makeUser({ username: `gm_owner_${ts}` });
    const member = await makeUser({ username: `gm_mem_${ts}` });
    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `gm群_${ts}`, memberIds: [member.userId] });
    convId = g.body.conversationId;
    expect(convId).toBeTruthy();
  });

  const getInfo = () => request(app).get(`/api/messages/conversation/${convId}/info`)
    .set('Authorization', `Bearer ${owner.token}`);
  const manage = (body) => request(app).put(`/api/messages/conversation/${convId}/manage`)
    .set('Authorization', `Bearer ${owner.token}`).send(body);

  test('开启 mute_all 后再开 no_private_chat，两者都为真、no_add_friend 保持关', async () => {
    let r = await manage({ mute_all: true });
    expect(r.status).toBe(200);
    expect(r.body.mute_all).toBe(1);

    // 只改 no_private_chat，不应影响已开启的 mute_all
    r = await manage({ no_private_chat: true });
    expect(r.status).toBe(200);
    expect(r.body.no_private_chat).toBe(1);

    const info = await getInfo();
    expect(info.body.mute_all).toBe(1);         // 未被误关
    expect(info.body.no_private_chat).toBe(1);
    expect(info.body.no_add_friend).toBe(0);    // 从未开启，仍为关
  });
});
