'use strict';
/**
 * 好友标签（friend_labels）全链路：CRUD + 成员增删 + 校验 + 授权隔离。
 * 覆盖 friend_labels.service（原覆盖率 ~8%）。走真实 HTTP，隔离测试库。
 */
const { request, app, makeUser, befriend } = require('./helpers');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('好友标签 friend-labels', () => {
  let alice, bob, carol;

  beforeAll(async () => {
    alice = await makeUser();
    bob = await makeUser();
    carol = await makeUser();
    await befriend(alice, bob);   // alice ↔ bob 好友
    // carol 与 alice 非好友，用于「只能把好友加入标签」的负例
  });

  test('创建标签 → 出现在列表', async () => {
    const res = await request(app).post('/api/friend-labels')
      .set(auth(alice.token)).send({ name: '同事', color: '#FF0000' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: '同事', color: '#FF0000' });
    expect(res.body.members).toEqual([]);
    expect(res.body.id).toBeTruthy();

    const list = await request(app).get('/api/friend-labels').set(auth(alice.token));
    expect(list.status).toBe(200);
    expect(list.body.some(l => l.id === res.body.id)).toBe(true);
  });

  test('空标签名被拒 400', async () => {
    const res = await request(app).post('/api/friend-labels')
      .set(auth(alice.token)).send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/标签名/);
  });

  test('标签名超长(>20)被拒 400', async () => {
    const res = await request(app).post('/api/friend-labels')
      .set(auth(alice.token)).send({ name: 'x'.repeat(21) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/20/);
  });

  test('非法颜色回退到默认绿', async () => {
    const res = await request(app).post('/api/friend-labels')
      .set(auth(alice.token)).send({ name: '家人', color: 'not-a-color' });
    expect(res.status).toBe(200);
    expect(res.body.color).toBe('#07C160');
  });

  test('更新标签名与颜色', async () => {
    const created = await request(app).post('/api/friend-labels')
      .set(auth(alice.token)).send({ name: '临时', color: '#123456' });
    const id = created.body.id;
    const res = await request(app).put(`/api/friend-labels/${id}`)
      .set(auth(alice.token)).send({ name: '重要', color: '#654321' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: '重要', color: '#654321' });
  });

  test('更新不存在的标签 → 404', async () => {
    const res = await request(app).put('/api/friend-labels/nope-id')
      .set(auth(alice.token)).send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  test('把好友加入标签 → 成员出现；重复加入幂等', async () => {
    const created = await request(app).post('/api/friend-labels')
      .set(auth(alice.token)).send({ name: '好友组' });
    const id = created.body.id;

    const add = await request(app).post(`/api/friend-labels/${id}/members`)
      .set(auth(alice.token)).send({ friendId: bob.userId });
    expect(add.status).toBe(200);
    expect(add.body).toMatchObject({ id: bob.userId });

    // 幂等：再加一次不报错
    const add2 = await request(app).post(`/api/friend-labels/${id}/members`)
      .set(auth(alice.token)).send({ friendId: bob.userId });
    expect(add2.status).toBe(200);

    const list = await request(app).get('/api/friend-labels').set(auth(alice.token));
    const label = list.body.find(l => l.id === id);
    expect(label.members.filter(m => m.id === bob.userId)).toHaveLength(1);
  });

  test('只能把好友加入标签：非好友 → 400', async () => {
    const created = await request(app).post('/api/friend-labels')
      .set(auth(alice.token)).send({ name: '陌生人组' });
    const res = await request(app).post(`/api/friend-labels/${created.body.id}/members`)
      .set(auth(alice.token)).send({ friendId: carol.userId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/好友/);
  });

  test('移除标签成员', async () => {
    const created = await request(app).post('/api/friend-labels')
      .set(auth(alice.token)).send({ name: '可移除组' });
    const id = created.body.id;
    await request(app).post(`/api/friend-labels/${id}/members`)
      .set(auth(alice.token)).send({ friendId: bob.userId });

    const del = await request(app).delete(`/api/friend-labels/${id}/members/${bob.userId}`)
      .set(auth(alice.token));
    expect(del.status).toBe(200);

    const list = await request(app).get('/api/friend-labels').set(auth(alice.token));
    const label = list.body.find(l => l.id === id);
    expect(label.members.some(m => m.id === bob.userId)).toBe(false);
  });

  test('删除标签 → 从列表消失', async () => {
    const created = await request(app).post('/api/friend-labels')
      .set(auth(alice.token)).send({ name: '待删除' });
    const id = created.body.id;
    const del = await request(app).delete(`/api/friend-labels/${id}`).set(auth(alice.token));
    expect(del.status).toBe(200);
    const list = await request(app).get('/api/friend-labels').set(auth(alice.token));
    expect(list.body.some(l => l.id === id)).toBe(false);
  });

  test('授权隔离：bob 看不到/改不了 alice 的标签', async () => {
    const created = await request(app).post('/api/friend-labels')
      .set(auth(alice.token)).send({ name: 'alice私有' });
    const id = created.body.id;

    // bob 的列表里不含 alice 的标签
    const bobList = await request(app).get('/api/friend-labels').set(auth(bob.token));
    expect(bobList.body.some(l => l.id === id)).toBe(false);

    // bob 更新/删除 alice 的标签 → 404（按 user_id 过滤，越权即不存在）
    const upd = await request(app).put(`/api/friend-labels/${id}`)
      .set(auth(bob.token)).send({ name: '篡改' });
    expect(upd.status).toBe(404);
    const del = await request(app).delete(`/api/friend-labels/${id}`).set(auth(bob.token));
    expect(del.status).toBe(404);
  });

  test('未登录访问 → 401', async () => {
    const res = await request(app).get('/api/friend-labels');
    expect(res.status).toBe(401);
  });
});
