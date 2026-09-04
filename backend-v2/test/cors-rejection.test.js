'use strict';
/**
 * CORS 拒绝的响应语义与日志（2026-09-04）。
 *
 * 背景：origin 回调此前 throw 的是裸 Error（无 status），一路落到 error.js 的兜底分支：
 *   · 响应 500「服务器内部错误」——语义错了，Origin 不在白名单是客户端条件，应是 403
 *   · 以 error 级别 + 整段堆栈写进 error.log / Sentry
 *   · 且完全没记下被拒的 Origin 是什么，真配错 CORS 时无从排查
 *   · 任何扫描器随便发个 Origin 就能刷错误日志，把真事故淹掉
 *     （生产日志实测 172 条 Unhandled error 全是这一条）
 */
require('./testEnv');
const request = require('supertest');
const { app } = require('./helpers');

describe('CORS 拒绝', () => {
  test('白名单外的 Origin → 403，而不是 500', async () => {
    const res = await request(app)
      .get('/api/config')
      .set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(500);
  });

  test('403 响应体是可读的业务错误，不是「服务器内部错误」', async () => {
    const res = await request(app)
      .get('/api/config')
      .set('Origin', 'https://evil.example.com');
    expect(res.body.error).toBe('Not allowed by CORS');
    expect(res.body.error).not.toContain('服务器内部错误');
    expect(res.body.error_code).toBe('CORS_FORBIDDEN');
  });

  test('不返回堆栈（拒绝是客户端条件，不该外泄内部实现）', async () => {
    const res = await request(app)
      .get('/api/config')
      .set('Origin', 'https://evil.example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*app\.js/);
    expect(res.body.stack).toBeUndefined();
  });

  test('无 Origin（同源/服务端调用）照常放行，不受影响', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
  });

  test('白名单内的 Origin 照常放行', async () => {
    const res = await request(app)
      .get('/api/config')
      .set('Origin', 'https://touliao.cc');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://touliao.cc');
  });
});
