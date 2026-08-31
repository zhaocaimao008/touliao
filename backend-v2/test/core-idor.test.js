'use strict';
/**
 * 核心流程回归：越权访问（横向越权 IDOR）专项。
 * 与 test/p1-02-uploads-idor.test.js（文件访问IDOR）互补，这里覆盖消息/会话/资料维度。
 * 每个用例本身就是"异常路径应该被正确拦截"，故这里的"正常路径"指"本人操作自己的资源应该成功"，
 * 用来反证拦截逻辑不是误伤所有请求。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');

describe('越权访问：消息编辑/撤回', () => {
  test('正常路径：本人编辑自己发的文本消息成功', async () => {
    const a = await makeUser({ username: 'idor_msg_a' });
    const b = await makeUser({ username: 'idor_msg_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    const sent = await request(app).post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`).send({ content: '原文' });

    const edit = await request(app).put(`/api/messages/${sent.body.id}/edit`)
      .set('Authorization', `Bearer ${a.token}`).send({ content: '改过的内容' });
    expect(edit.status).toBe(200);
  });

  test('异常路径：B 尝试编辑 A 发的消息 → 403，内容不会被篡改', async () => {
    const a = await makeUser({ username: 'idor_msg_c' });
    const b = await makeUser({ username: 'idor_msg_d' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    const sent = await request(app).post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`).send({ content: '不许改我' });

    const edit = await request(app).put(`/api/messages/${sent.body.id}/edit`)
      .set('Authorization', `Bearer ${b.token}`).send({ content: '被篡改了' });
    expect(edit.status).toBe(403);

    const history = await request(app).get(`/api/messages/${convId}`).set('Authorization', `Bearer ${a.token}`);
    const msg = history.body.find(m => m.id === sent.body.id);
    expect(msg.content).toBe('不许改我');
  });

  test('异常路径：与会话无关的第三人尝试撤回消息 → 403', async () => {
    const a = await makeUser({ username: 'idor_msg_e' });
    const b = await makeUser({ username: 'idor_msg_f' });
    const stranger = await makeUser({ username: 'idor_msg_stranger' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    const sent = await request(app).post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`).send({ content: '别撤回我' });

    const del = await request(app).delete(`/api/messages/${sent.body.id}`)
      .set('Authorization', `Bearer ${stranger.token}`).send({ forEveryone: true });
    expect(del.status).toBe(403);
  });
});

describe('越权访问：会话历史', () => {
  test('异常路径：非会话成员读取他人私聊历史 → 403，读不到任何消息内容', async () => {
    const a = await makeUser({ username: 'idor_conv_a' });
    const b = await makeUser({ username: 'idor_conv_b' });
    const eavesdropper = await makeUser({ username: 'idor_eavesdropper' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    await request(app).post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`).send({ content: '悄悄话' });

    const peek = await request(app).get(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${eavesdropper.token}`);
    expect(peek.status).toBe(403);
    expect(JSON.stringify(peek.body)).not.toMatch(/悄悄话/);
  });
});

describe('越权访问：资料/收藏', () => {
  test('正常路径：本人查看自己的收藏列表成功', async () => {
    const a = await makeUser({ username: 'idor_col_a' });
    const add = await request(app).post('/api/users/me/collections')
      .set('Authorization', `Bearer ${a.token}`).send({ type: 'text', content: '我的收藏' });
    expect(add.status).toBe(200);
    const list = await request(app).get('/api/users/me/collections').set('Authorization', `Bearer ${a.token}`);
    expect(list.status).toBe(200);
    expect(list.body.some(c => c.content === '我的收藏')).toBe(true);
  });

  test('异常路径：B 尝试用 A 收藏记录的 id 去删除自己名下不存在的同名资源 → 404（不能跨账号删除别人收藏）', async () => {
    const a = await makeUser({ username: 'idor_col_b' });
    const b = await makeUser({ username: 'idor_col_c' });
    const add = await request(app).post('/api/users/me/collections')
      .set('Authorization', `Bearer ${a.token}`).send({ type: 'text', content: 'A的私有收藏' });
    const collectionId = add.body.id;

    const del = await request(app).delete(`/api/users/me/collections/${collectionId}`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(del.status).toBe(404);

    // A 自己的收藏应仍然存在
    const stillThere = await request(app).get('/api/users/me/collections').set('Authorization', `Bearer ${a.token}`);
    expect(stillThere.body.some(c => c.id === collectionId)).toBe(true);
  });

  test('异常路径：改资料接口不接受目标 userId 参数篡改他人资料（只认 token 身份）', async () => {
    const a = await makeUser({ username: 'idor_profile_a' });
    const b = await makeUser({ username: 'idor_profile_b' });
    // 即便在 body 里塞入 b 的 id，后端也应该只更新 a 自己（updateProfile 从不读 body.userId）
    const res = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${a.token}`).send({ username: 'a_renamed', userId: b.userId, id: b.userId });
    expect(res.status).toBe(200);

    const bProfile = await request(app).get(`/api/users/${b.userId}`).set('Authorization', `Bearer ${a.token}`);
    expect(bProfile.body.username).not.toBe('a_renamed');
  });
});
