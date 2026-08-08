'use strict';
/**
 * 勿扰时段（夜间免打扰）功能测试：
 *   1. 设置接口 PUT /api/users/me/settings 存 quiet_enabled/start/end
 *   2. GET /api/users/me/settings 返回 quietEnabled/quietStart/quietEnd
 *   3. isInQuietHours 工具函数覆盖跨夜/当日/边界场景
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser } = require('./helpers');
const { isInQuietHours } = require('../src/utils/push');

// 工具：伪造指定时刻 new Date() 的 HH:MM 检查
function makeDate(h, m) {
  const d = new Date(2024, 0, 1, h, m, 0);
  return d;
}

describe('isInQuietHours 工具函数', () => {
  test('跨夜区间 23:00~07:00：23:30 在内', () => {
    expect(isInQuietHours('23:00', '07:00', makeDate(23, 30))).toBe(true);
  });
  test('跨夜区间 23:00~07:00：03:00 在内', () => {
    expect(isInQuietHours('23:00', '07:00', makeDate(3, 0))).toBe(true);
  });
  test('跨夜区间 23:00~07:00：07:00 不在内（边界为左闭右开）', () => {
    expect(isInQuietHours('23:00', '07:00', makeDate(7, 0))).toBe(false);
  });
  test('跨夜区间 23:00~07:00：12:00 不在内', () => {
    expect(isInQuietHours('23:00', '07:00', makeDate(12, 0))).toBe(false);
  });
  test('当日区间 09:00~12:00：10:00 在内', () => {
    expect(isInQuietHours('09:00', '12:00', makeDate(10, 0))).toBe(true);
  });
  test('当日区间 09:00~12:00：12:00 不在内', () => {
    expect(isInQuietHours('09:00', '12:00', makeDate(12, 0))).toBe(false);
  });
  test('起止相同：永远 false', () => {
    expect(isInQuietHours('23:00', '23:00', makeDate(23, 0))).toBe(false);
  });
  test('非法格式：安全降级返回 false', () => {
    expect(isInQuietHours('25:00', '07:00', makeDate(12, 0))).toBe(false);
    expect(isInQuietHours(null, '07:00', makeDate(12, 0))).toBe(false);
    expect(isInQuietHours('9:0',  '07:00', makeDate(12, 0))).toBe(false);
  });
});

describe('勿扰时段 HTTP 接口', () => {
  let u;

  beforeAll(async () => { u = await makeUser(); });

  test('设置勿扰时段：接口返回最新 settings', async () => {
    const res = await request(app)
      .put('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ quietEnabled: true, quietStart: '22:00', quietEnd: '08:00' });
    expect(res.status).toBe(200);
    expect(res.body.quietEnabled).toBe(true);
    expect(res.body.quietStart).toBe('22:00');
    expect(res.body.quietEnd).toBe('08:00');
  });

  test('GET settings 返回已存勿扰设置', async () => {
    const res = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    expect(res.body.quietEnabled).toBe(true);
    expect(res.body.quietStart).toBe('22:00');
    expect(res.body.quietEnd).toBe('08:00');
  });

  test('非法时间格式被忽略，旧值保留', async () => {
    const res = await request(app)
      .put('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ quietStart: '25:99' }); // 非法，忽略
    expect(res.status).toBe(200);
    // 旧值 22:00 应保留
    expect(res.body.quietStart).toBe('22:00');
  });

  test('关闭勿扰：quietEnabled=false 存储成功', async () => {
    const res = await request(app)
      .put('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ quietEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body.quietEnabled).toBe(false);
  });
});
