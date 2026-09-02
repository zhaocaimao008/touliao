'use strict';
/**
 * 群管理中间态（2026-09-02）：后台之前只能"查看群列表"或"强制解散"，没有更轻量的操作。
 * 补 PUT /api/admin/groups/:id/mute（全员禁言开关）+ DELETE /api/admin/groups/:id/members/:userId（踢单人）。
 */
const jwt = require('jsonwebtoken');
const { request, app, makeUser, befriend } = require('./helpers');
const config = require('../src/config');
const { db } = require('../src/db/connection');

function adminToken() {
  const csrf = 'admgrp-csrf-token';
  return jwt.sign(
    { admin: true, username: config.admin.username, csrf },
    config.adminJwtSecret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

function adminReq(method, path) {
  return request(app)[method](`/api/admin${path}`)
    .set('Cookie', `touliao_admin_token=${adminToken()}`)
    .set('X-CSRF-Token', 'admgrp-csrf-token');
}

async function makeGroup(owner, member) {
  const res = await request(app)
    .post('/api/messages/conversation/group')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '管理测试群', memberIds: [member.userId] });
  expect(res.status).toBe(200);
  return res.body.id || res.body.conversationId;
}

describe('管理员群管理中间态', () => {
  test('开启/关闭全员禁言', async () => {
    const owner = await makeUser({ username: 'admgrp_mute_owner' });
    const member = await makeUser({ username: 'admgrp_mute_member' });
    await befriend(owner, member);
    const groupId = await makeGroup(owner, member);

    const on = await adminReq('put', `/groups/${groupId}/mute`).send({ mute_all: true });
    expect(on.status).toBe(200);
    expect(on.body.mute_all).toBe(1);
    expect(db.prepare('SELECT mute_all FROM conversations WHERE id=?').get(groupId).mute_all).toBe(1);

    const off = await adminReq('put', `/groups/${groupId}/mute`).send({ mute_all: false });
    expect(off.status).toBe(200);
    expect(off.body.mute_all).toBe(0);
  });

  test('移除单个普通成员：从成员表消失，群依然存在', async () => {
    const owner = await makeUser({ username: 'admgrp_kick_owner' });
    const member = await makeUser({ username: 'admgrp_kick_member' });
    await befriend(owner, member);
    const groupId = await makeGroup(owner, member);

    const res = await adminReq('delete', `/groups/${groupId}/members/${member.userId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(groupId, member.userId);
    expect(row).toBeUndefined();
    const conv = db.prepare("SELECT 1 FROM conversations WHERE id=? AND type='group'").get(groupId);
    expect(conv).toBeTruthy();
  });

  test('不能移除群主', async () => {
    const owner = await makeUser({ username: 'admgrp_ko_owner' });
    const member = await makeUser({ username: 'admgrp_ko_member' });
    await befriend(owner, member);
    const groupId = await makeGroup(owner, member);

    const res = await adminReq('delete', `/groups/${groupId}/members/${owner.userId}`);
    expect(res.status).toBe(400);
    const row = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(groupId, owner.userId);
    expect(row).toBeTruthy();
  });

  test('移除不存在的成员返回 404', async () => {
    const owner = await makeUser({ username: 'admgrp_k4_owner' });
    const member = await makeUser({ username: 'admgrp_k4_member' });
    await befriend(owner, member);
    const groupId = await makeGroup(owner, member);

    const res = await adminReq('delete', `/groups/${groupId}/members/does-not-exist`);
    expect(res.status).toBe(404);
  });

  test('操作不存在的群返回 404', async () => {
    const mute = await adminReq('put', '/groups/does-not-exist/mute').send({ mute_all: true });
    expect(mute.status).toBe(404);
    const kick = await adminReq('delete', '/groups/does-not-exist/members/whoever');
    expect(kick.status).toBe(404);
  });

  test('未带管理员 cookie 返回 401/403', async () => {
    const res = await request(app).put('/api/admin/groups/whatever/mute').send({ mute_all: true });
    expect([401, 403]).toContain(res.status);
  });
});
