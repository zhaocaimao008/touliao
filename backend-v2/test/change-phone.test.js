'use strict';
/**
 * 换绑手机号功能测试：PUT /api/users/me/phone
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser } = require('./helpers');

describe('换绑手机号', () => {
  let user;

  beforeAll(async () => {
    user = await makeUser();
  });

  test('正常换绑：成功后返回新手机号', async () => {
    const newPhone = `+86-199${Date.now().toString().slice(-8)}`.slice(0, 18);
    const res = await request(app)
      .put('/api/users/me/phone')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ new_phone: newPhone, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.phone).toBe(newPhone);

    // 换绑后旧手机号无法登录
    const loginOld = await request(app)
      .post('/api/auth/login')
      .send({ phone: user.phone, password: user.password });
    expect(loginOld.status).toBe(400); // 手机号已变，登录失败

    // 新手机号可以登录
    const loginNew = await request(app)
      .post('/api/auth/login')
      .send({ phone: newPhone, password: user.password });
    expect(loginNew.status).toBe(200);

    // 更新 user.phone 以便后续测试使用
    user.phone = newPhone;
  });

  test('密码错误时返回 400', async () => {
    const res = await request(app)
      .put('/api/users/me/phone')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ new_phone: '+86-19900000001', password: 'wrongpassword' });
    expect(res.status).toBe(400);
  });

  test('新手机号格式不合法时返回 400', async () => {
    const res = await request(app)
      .put('/api/users/me/phone')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ new_phone: 'abc', password: user.password });
    expect(res.status).toBe(400);
  });

  test('新手机号与当前号相同时返回 400', async () => {
    const res = await request(app)
      .put('/api/users/me/phone')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ new_phone: user.phone, password: user.password });
    expect(res.status).toBe(400);
  });

  test('新手机号已被他人占用时返回 400', async () => {
    const other = await makeUser();
    const res = await request(app)
      .put('/api/users/me/phone')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ new_phone: other.phone, password: user.password });
    expect(res.status).toBe(400);
  });

  test('未登录时返回 401', async () => {
    const res = await request(app)
      .put('/api/users/me/phone')
      .send({ new_phone: '+86-19900000099', password: 'passw0rd' });
    expect(res.status).toBe(401);
  });

  test('缺少参数时返回 400', async () => {
    const res = await request(app)
      .put('/api/users/me/phone')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ new_phone: '+86-19900000077' }); // 无 password
    expect(res.status).toBe(400);
  });
});
