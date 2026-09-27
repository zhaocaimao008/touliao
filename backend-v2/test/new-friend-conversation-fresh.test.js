'use strict';
/**
 * 通过好友申请后，客户端立刻重拉会话列表/通讯录必须拿到新好友：
 * 1) 列表接口不能用 max-age（否则浏览器/URLSession 在 10~90 秒内直接返回本地旧列表）
 * 2) 没有消息的新私聊 lastTime 取会话创建时间（客户端按 lastTime 重排，为空会沉到最底部）
 */
require('./testEnv');
const { request, app, makeUser, befriend } = require('./helpers');

describe('新好友会话在列表中立即可见（lastTime 非空）', () => {
  test('会话列表与通讯录每次回源校验；新私聊 lastTime 非空', async () => {
    const a = await makeUser({ username: 'fresh_a' });
    const b = await makeUser({ username: 'fresh_b' });
    await befriend(a, b);

    const convs = await request(app).get('/api/messages/conversations?includeArchived=1').set('Authorization', `Bearer ${a.token}`);
    expect(convs.status).toBe(200);
    expect(convs.headers['cache-control']).toMatch(/no-cache/);
    expect(convs.headers['cache-control']).not.toMatch(/max-age/);
    // 首次拉列表才会自动建「文件传输助手」（同一秒创建，先后不定），所以按名字找
    const conv = convs.body.find(c => c.name === 'fresh_b');
    expect(conv).toBeTruthy();
    expect(conv.lastTime).toBeGreaterThan(0);

    const contacts = await request(app).get('/api/users/contacts').set('Authorization', `Bearer ${a.token}`);
    expect(contacts.body.some(c => c.username === 'fresh_b' || c.id === b.userId)).toBe(true);
    expect(contacts.headers['cache-control']).toMatch(/no-cache/);
    expect(contacts.headers['cache-control']).not.toMatch(/max-age/);
  });
});
