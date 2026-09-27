'use strict';
/**
 * 强制升级：GET /api/config → minVersion；后台 PUT /api/admin/min-versions 修改并即时生效。
 */
const jwt = require('jsonwebtoken');
const { request, app } = require('./helpers');
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


afterAll(() => {
  db.prepare("DELETE FROM admin_settings WHERE key LIKE 'min_version_%'").run();
});

describe('客户端最低版本', () => {
  test('默认不强制：三端均为 0/空', async () => {
    db.prepare("DELETE FROM admin_settings WHERE key LIKE 'min_version_%'").run();
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.minVersion).toEqual({ android: 0, ios: 0, desktop: '' });
  });

  test('后台设置后 /api/config 立即返回新值', async () => {
    const put = await adminReq('put', '/min-versions').send({ android: 88, ios: '1790439420', desktop: '8.1.35' });
    expect(put.status).toBe(200);
    const res = await request(app).get('/api/config');
    expect(res.body.minVersion).toEqual({ android: 88, ios: 1790439420, desktop: '8.1.35' });
  });

  test('格式不正确 → 400，且不改动已有值', async () => {
    const bad = await adminReq('put', '/min-versions').send({ android: '8.1.31' });
    expect(bad.status).toBe(400);
    const res = await request(app).get('/api/config');
    expect(res.body.minVersion.android).toBe(88);
  });

  test('未登录后台不能修改', async () => {
    const res = await request(app).put('/api/admin/min-versions').send({ android: 1 });
    expect([401, 403]).toContain(res.status);
  });
});
