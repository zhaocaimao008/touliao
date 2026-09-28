'use strict';
/**
 * 会话列表 2s 缓存的新鲜度：客户端收到 group_updated / user_profile_updated / new_message / 已读同步等
 * 事件后会立刻重拉列表，且之后不再刷新。变更若不失效相关成员的缓存，这次重拉拿到的就是事件之前的
 * 旧数据，界面一直停在旧群名、旧昵称、旧预览或残留未读上（两账号实测复现率 100%）。
 */
const { request, app, makeUser, befriend } = require('./helpers');
const msgSvc = require('../src/modules/messages/messages.service');

const auth = u => ['Authorization', `Bearer ${u.token}`];
const listRow = async (u, id) => (await request(app).get('/api/messages/conversations').set(...auth(u))).body
  .find(c => c.id === id);

describe('会话列表缓存在变更后立即反映最新状态', () => {
  let a, b, gid;
  beforeAll(async () => {
    a = await makeUser({ username: 'clf_a' });
    b = await makeUser({ username: 'clf_b' });
    await befriend(a, b);
    const g = await request(app).post('/api/messages/conversation/group').set(...auth(a)).send({ name: '旧群名', memberIds: [b.userId] });
    gid = g.body.conversationId;
  });

  test('群主改群名：成员刚拉过列表，立刻重拉即是新群名', async () => {
    await listRow(b, gid); // 预热 B 的缓存
    await request(app).put(`/api/messages/conversation/${gid}`).set(...auth(a)).send({ name: '新群名' });
    expect((await listRow(b, gid)).name).toBe('新群名');
  });

  test('新消息：成员刚拉过列表，立刻重拉即是新预览与未读', async () => {
    await listRow(b, gid);
    await msgSvc.send(null, gid, a.userId, { content: '列表新鲜度' });
    const row = await listRow(b, gid);
    expect(row.lastMessage).toBe('列表新鲜度');
    expect(row.unreadCount).toBe(1);
  });

  test('标记已读后立刻重拉：未读为 0', async () => {
    await listRow(b, gid);
    await request(app).post(`/api/messages/conversation/${gid}/read`).set(...auth(b));
    expect((await listRow(b, gid)).unreadCount).toBe(0);
  });

  test('被移出群：刚拉过列表，立刻重拉即不再有该群', async () => {
    await listRow(b, gid);
    await request(app).delete(`/api/messages/conversation/${gid}/members/${b.userId}`).set(...auth(a));
    expect(await listRow(b, gid)).toBeUndefined();
  });
});
