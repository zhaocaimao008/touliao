'use strict';
/**
 * 推送诊断端点加固（2026-09-04）。
 *
 * 加固前：
 *   · /api/push/getui-diag 挂在 /api 的 CSRF 与鉴权之前，唯一凭据是源码里硬编码的
 *     'diag2026'——这个串既在仓库里、也随 Android APK 发出去，等于公开。
 *   · 每次请求 appendFileSync 把攻击者可控的 JSON 追加进文件：同步写阻塞事件循环、
 *     文件无上限增长、内容不截断。合起来是一条无鉴权的低成本 DoS。
 *   · 日志路径写死 /root/touliao/backend-v2/push-diag.log。
 *
 * 加固后：未配 PUSH_DIAG_TOKEN 就整个关闭（404），这也是线上默认状态。
 * 本用例锁的就是「默认不开面」这条。
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser } = require('./helpers');

describe('诊断端点默认关闭（未配 PUSH_DIAG_TOKEN）', () => {
  test('getui-diag：不带 token → 404，而不是暴露 403 探测面', async () => {
    const res = await request(app).post('/api/push/getui-diag').send({ a: 1 });
    expect(res.status).toBe(404);
  });

  test('getui-diag：带旧的硬编码 token diag2026 也进不去', async () => {
    const res = await request(app)
      .post('/api/push/getui-diag')
      .set('X-Diag-Token', 'diag2026')
      .send({ a: 1 });
    expect(res.status).toBe(404);
  });

  test('getui-diag：超大 body 也不会被写盘（端点根本不开）', async () => {
    const res = await request(app)
      .post('/api/push/getui-diag')
      .set('X-Diag-Token', 'diag2026')
      .send({ blob: 'x'.repeat(50000) });
    expect(res.status).toBe(404);
  });

  test('push-diag：已登录用户也拿到 404（未开启即无此端点）', async () => {
    const u = await makeUser();
    const res = await request(app)
      .post('/api/notifications/push-diag')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ message: 'hi' });
    expect(res.status).toBe(404);
  });
});
