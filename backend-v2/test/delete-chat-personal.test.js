'use strict';
/**
 * 删除聊天（仅自己）：此前网页会话列表的"删除聊天"调用双向清空接口，不弹确认就把对方的聊天记录也删了，
 * 且会话仍在列表里、刷新后又回来。现在：只清我这一侧 + 从我的列表隐藏，新消息到来时自动回来。
 */
require('./testEnv');
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const messages = require('../src/modules/messages/messages.service');

const list = async u => (await request(app).get('/api/messages/conversations?includeArchived=1').set('Authorization', `Bearer ${u.token}`)).body;
const history = async (u, convId) => {
  const res = await request(app).get(`/api/messages/${convId}`).set('Authorization', `Bearer ${u.token}`);
  return (Array.isArray(res.body) ? res.body : res.body.messages || []).map(m => m.content);
};

describe('删除聊天（仅自己）', () => {
  test('只影响自己：我的列表移除、我的记录清空；对方记录完整；对方新消息到来后会话回来', async () => {
    const a = await makeUser({ username: 'hide_a' });
    const b = await makeUser({ username: 'hide_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    await messages.send(null, convId, b.userId, { content: '旧消息1', type: 'text' });
    await messages.send(null, convId, a.userId, { content: '旧消息2', type: 'text' });

    const res = await request(app).post(`/api/messages/conversation/${convId}/hide`).set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);

    expect((await list(a)).some(c => c.id === convId)).toBe(false);
    expect(await history(a, convId)).toEqual([]);
    expect(await history(b, convId)).toEqual(expect.arrayContaining(['旧消息1', '旧消息2']));
    expect((await list(b)).some(c => c.id === convId)).toBe(true);

    await messages.send(null, convId, b.userId, { content: '新消息', type: 'text' });
    const back = (await list(a)).find(c => c.id === convId);
    expect(back).toBeTruthy();
    expect(back.lastMessage).toBe('新消息');
    expect(await history(a, convId)).toEqual(['新消息']);
  });

  test('从通讯录重新打开会话即取消隐藏；非成员不能操作', async () => {
    const a = await makeUser({ username: 'hide_c' });
    const b = await makeUser({ username: 'hide_d' });
    const x = await makeUser({ username: 'hide_x' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    await request(app).post(`/api/messages/conversation/${convId}/hide`).set('Authorization', `Bearer ${a.token}`);
    expect((await list(a)).some(c => c.id === convId)).toBe(false);
    expect(await privateConversation(a, b)).toBe(convId);
    expect((await list(a)).some(c => c.id === convId)).toBe(true);

    const denied = await request(app).post(`/api/messages/conversation/${convId}/hide`).set('Authorization', `Bearer ${x.token}`);
    expect(denied.status).toBe(403);
  });
});
