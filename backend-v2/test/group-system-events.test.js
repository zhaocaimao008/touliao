'use strict';
/**
 * 群系统提示：建群/邀请/链接入群/移出/改群名/全员禁言/设管理员/转让群主都会在群里写一条
 * type='system' 消息（content 为人话，file_url 为结构化 JSON）；系统消息不计未读、不进搜索。
 */
const { request, app, makeUser, befriend } = require('./helpers');
const { db } = require('../src/db/connection');
const convSvc = require('../src/modules/conversations/conversations.service');
const msgSvc = require('../src/modules/messages/messages.service');

const sysMsgs = gid => db.prepare("SELECT content, file_url FROM messages WHERE conversation_id=? AND type='system' ORDER BY rowid").all(gid);
async function waitSys(gid, n) {
  for (let i = 0; i < 50; i++) { const r = sysMsgs(gid); if (r.length >= n) return r; await new Promise(r => setTimeout(r, 20)); }
  return sysMsgs(gid);
}
const auth = u => ['Authorization', `Bearer ${u.token}`];

describe('群系统提示', () => {
  let owner, b, c, d, gid;
  beforeAll(async () => {
    owner = await makeUser({ username: 'gse_owner' });
    b = await makeUser({ username: 'gse_b' });
    c = await makeUser({ username: 'gse_c' });
    d = await makeUser({ username: 'gse_d' });
    await befriend(owner, b); await befriend(owner, c);
  });

  test('建群：「X 邀请 A、B 加入了群聊」，结构化信息带 actor 与 targets', async () => {
    const g = await request(app).post('/api/messages/conversation/group').set(...auth(owner)).send({ name: '系统提示群', memberIds: [b.userId] });
    gid = g.body.conversationId;
    const [m] = await waitSys(gid, 1);
    expect(m.content).toBe('gse_owner 邀请 gse_b 加入了群聊');
    const meta = JSON.parse(m.file_url);
    expect(meta).toMatchObject({ event: 'invited', actorId: owner.userId, targets: [{ id: b.userId, name: 'gse_b' }] });
  });

  test('邀请 / 链接入群 / 改群名 / 全员禁言 / 设管理员 / 转让群主 / 移出 各写一条', async () => {
    await request(app).post(`/api/messages/conversation/${gid}/invite`).set(...auth(owner)).send({ userIds: [c.userId] });
    const link = await request(app).post(`/api/messages/conversation/${gid}/invite-link`).set(...auth(owner));
    await request(app).post(`/api/messages/join/${link.body.token}`).set(...auth(d));
    await request(app).put(`/api/messages/conversation/${gid}`).set(...auth(owner)).send({ name: '改过的群名' });
    await request(app).put(`/api/messages/conversation/${gid}/manage`).set(...auth(owner)).send({ mute_all: true });
    await request(app).put(`/api/messages/conversation/${gid}/manage`).set(...auth(owner)).send({ mute_all: true }); // 无变化不重复写
    await request(app).put(`/api/messages/conversation/${gid}/members/${b.userId}/role`).set(...auth(owner)).send({ role: 'admin' });
    await request(app).post(`/api/messages/conversation/${gid}/transfer-owner`).set(...auth(owner)).send({ userId: c.userId });
    await request(app).delete(`/api/messages/conversation/${gid}/members/${d.userId}`).set(...auth(c));
    const texts = (await waitSys(gid, 8)).map(m => m.content);
    expect(texts).toEqual([
      'gse_owner 邀请 gse_b 加入了群聊',
      'gse_owner 邀请 gse_c 加入了群聊',
      'gse_d 通过邀请链接加入了群聊',
      'gse_owner 修改群名为「改过的群名」',
      'gse_owner 开启了全员禁言',
      'gse_owner 将 gse_b 设为管理员',
      'gse_owner 已将群主转让给 gse_c',
      'gse_c 将 gse_d 移出了群聊',
    ]);
  });

  test('系统消息不计未读、不进会话内搜索', async () => {
    expect(convSvc.unreadCounts(b.userId)[gid] || 0).toBe(0);
    const found = await msgSvc.searchInConversation(gid, b.userId, '群聊', {});
    const list = Array.isArray(found) ? found : (found.messages || found.results || []);
    expect(list.filter(m => m.type === 'system')).toHaveLength(0);
  });
});
