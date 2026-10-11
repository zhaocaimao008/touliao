'use strict';
/**
 * 2026-10-11 perf/auth：auth.js / adminAuth.js 先验签、再查黑名单；tokenBlacklist.cleanCache 加上限并以 sha256 为键。
 * failing-first：旧实现对任意垃圾 token 先 isBlacklisted（SQLite 查询 + 以原串写入 cleanCache），
 *   匿名请求即可撑大进程内存 → 「垃圾 token 不触达黑名单查询」用例在旧代码上失败。
 * 语义保持：被吊销的合法 token 仍 401；黑名单查询异常仍 503（H2 不降级放行），不能被前置验签吞成 401。
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
// 必须先于 ./helpers（加载 app）安装 spy：auth.js / adminAuth.js 在模块加载时解构 isBlacklisted。
// spy 默认透传真实实现（真实 SQLite），只用于观察调用、注入一次性故障。
const tokenBlacklist = require('../src/utils/tokenBlacklist');
const lookup = jest.spyOn(tokenBlacklist, 'isBlacklisted');
const { app, request, makeUser } = require('./helpers');

const { addToBlacklist, _cleanCache: cleanCache } = tokenBlacklist;
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const lookedUp = token => lookup.mock.calls.some(([t]) => t === token);
const adminToken = csrf => jwt.sign({ admin: true, username: config.admin.username, csrf }, config.adminJwtSecret, { expiresIn: 600 });
const asAdmin = token => request(app).get('/api/admin/me').set('Cookie', `${config.admin.cookieName}=${token}`);

let user;
beforeAll(async () => { user = await makeUser(); });

/** 攻击形态：随机 4KB 非 JWT 串 / alg=none 未签名 JWT / 错误密钥签名的 JWT。 */
function garbageTokens(claims, wrongSecret) {
  return [
    crypto.randomBytes(3072).toString('base64url'),
    `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`,
    jwt.sign(claims, wrongSecret, { expiresIn: 600 }),
  ];
}

test('用户鉴权：垃圾/未签名/错签 token 返回 401，不触达黑名单查询、不写入 cleanCache（cookie 与 Bearer）', async () => {
  const tokens = garbageTokens({ id: user.userId, csrf: 'perf-auth' }, 'perf-auth-wrong-user-signing-secret-32+chars');
  for (const token of tokens) {
    for (const transport of ['cookie', 'bearer']) {
      lookup.mockClear();
      const sizeBefore = cleanCache.size;
      const req = request(app).get('/api/auth/me');
      const res = transport === 'cookie'
        ? await req.set('Cookie', `${config.cookieName}=${token}`)
        : await req.set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Token无效或已过期');
      expect(lookedUp(token)).toBe(false);
      expect(cleanCache.has(sha256(token))).toBe(false);
      expect(cleanCache.has(token)).toBe(false);
      // ≤ 而非 ===：容忍 5 分钟清扫恰好回收过期项，只断言"没有新增"
      expect(cleanCache.size).toBeLessThanOrEqual(sizeBefore);
    }
  }
});

test('后台鉴权：垃圾/未签名/错签 admin cookie 同样 401，不触达黑名单查询、不写入 cleanCache', async () => {
  const claims = { admin: true, username: config.admin.username, csrf: 'perf-auth' };
  for (const token of garbageTokens(claims, 'perf-auth-wrong-admin-signing-secret-32+chars')) {
    lookup.mockClear();
    const sizeBefore = cleanCache.size;
    const res = await asAdmin(token);
    expect(res.status).toBe(401);
    expect(lookedUp(token)).toBe(false);
    expect(cleanCache.has(sha256(token))).toBe(false);
    expect(cleanCache.size).toBeLessThanOrEqual(sizeBefore);
  }
});

test('合法 token 照常通过，cleanCache 以 sha256(token) 为键而非原始 token 串', async () => {
  lookup.mockClear();
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${user.token}`);
  expect(res.status).toBe(200);
  expect(lookedUp(user.token)).toBe(true);
  expect(cleanCache.has(sha256(user.token))).toBe(true);
  expect(cleanCache.has(user.token)).toBe(false);
});

test('被吊销的合法 token 仍 401：吊销时按哈希键驱逐已缓存的干净条目（用户与后台）', async () => {
  const victim = await makeUser();
  const me = () => request(app).get('/api/auth/me').set('Authorization', `Bearer ${victim.token}`);
  expect((await me()).status).toBe(200);
  expect(cleanCache.has(sha256(victim.token))).toBe(true);
  await addToBlacklist(victim.token, jwt.decode(victim.token).exp);
  expect(cleanCache.has(sha256(victim.token))).toBe(false);
  const revoked = await me();
  expect(revoked.status).toBe(401);
  expect(revoked.body.error).toBe('无效的Token，请重新登录');

  const token = adminToken('perf-auth-admin-revoke');
  expect((await asAdmin(token)).status).toBe(200);
  await addToBlacklist(token, jwt.decode(token).exp);
  expect((await asAdmin(token)).status).toBe(401);
});

test('黑名单查询异常仍返回 503（H2 不降级放行），用户与后台均不被吞成 401', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const token = adminToken('perf-auth-admin-outage');
  try {
    lookup.mockClear();
    lookup.mockRejectedValueOnce(new Error('synthetic blacklist outage'));
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(503);
    expect(lookup).toHaveBeenCalledWith(user.token);

    lookup.mockClear();
    lookup.mockRejectedValueOnce(new Error('synthetic blacklist outage'));
    const admin = await asAdmin(token);
    expect(admin.status).toBe(503);
    expect(lookup).toHaveBeenCalledWith(token);
  } finally { log.mockRestore(); }
  // 故障消失后恢复正常
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${user.token}`)).status).toBe(200);
  expect((await asAdmin(token)).status).toBe(200);
});

test('cleanCache 有 10k 上限，超出时淘汰最早写入的条目', async () => {
  const MAX = 10_000;
  const keys = Array.from({ length: MAX + 5 }, (_, i) => `perf-auth-cap-${i}`);
  for (const k of keys) expect(await tokenBlacklist.isBlacklisted(k)).toBe(false);
  expect(cleanCache.size).toBe(MAX);
  // 先前用例留下的条目与 keys[0..4] 最早写入 → 被淘汰；其余仍在
  expect(cleanCache.has(sha256(keys[0]))).toBe(false);
  expect(cleanCache.has(sha256(keys[4]))).toBe(false);
  expect(cleanCache.has(sha256(keys[5]))).toBe(true);
  expect(cleanCache.has(sha256(keys[MAX + 4]))).toBe(true);
  expect(cleanCache.has(keys[MAX + 4])).toBe(false);
}, 30_000);
