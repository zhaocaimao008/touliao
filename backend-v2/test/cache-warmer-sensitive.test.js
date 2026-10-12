'use strict';
// 2026-10-12 安全修复：CacheWarmer 不再把 users 整行（password 哈希、phone）写进 Redis 的 user:<id>，
// 并在启动时一次性清理旧版写入的含敏感字段的键。
const { app, request, makeUser } = require('./helpers');
const CacheWarmer = require('../src/utils/cacheWarmer');
const { USER_CACHE_COLUMNS } = require('../src/utils/cache');
const { redis } = require('../src/utils/redis');   // NODE_ENV=test → 内存 mock

const PUBLIC_COLUMNS = USER_CACHE_COLUMNS.split(',').sort();

afterAll(async () => { await require('../src/db/writer').shutdown(); });

/** 支持 SCAN 分页的最小内存 Redis（ioredis 调用约定）。 */
function fakeRedis(initial = {}, { failScan = false } = {}) {
  const store = new Map(Object.entries(initial));
  const calls = { del: [], scan: 0 };
  return {
    store,
    calls,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v) { store.set(k, String(v)); return 'OK'; },
    async mget(...keys) { return keys.map(k => (typeof store.get(k) === 'string' ? store.get(k) : null)); },
    async del(...keys) {
      calls.del.push(...keys);
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
    // 每页 2 个，强制走多轮游标
    async scan(cursor, _m, pattern, _c, _count) {
      calls.scan++;
      if (failScan) throw new Error('synthetic scan failure');
      const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      const all = [...store.keys()].filter(k => re.test(k)).sort();
      const start = Number(cursor);
      const page = all.slice(start, start + 2);
      const next = start + 2 >= all.length ? '0' : String(start + 2);
      return [next, page];
    },
  };
}

describe('CacheWarmer 只缓存公开资料列', () => {
  test('warmActiveUsers 写入的 user:<id> 不含 password/phone，列与 getUserDetail 缓存一致', async () => {
    const u = await makeUser();
    const result = await new CacheWarmer({ maxActiveUsers: 1000 }).warmActiveUsers();
    expect(result.error).toBeUndefined();
    expect(result.cached).toBeGreaterThan(0);
    const cached = JSON.parse(await redis.get(`user:${u.userId}`));
    expect(cached.id).toBe(u.userId);
    expect(cached.username).toBe(u.username);
    expect(Object.keys(cached).sort()).toEqual(PUBLIC_COLUMNS);
    expect(cached).not.toHaveProperty('password');
    expect(cached).not.toHaveProperty('phone');
  });

  test('warmUserData 与 /api/optimization/cache/warm-user 响应都不含 password/phone', async () => {
    const u = await makeUser();
    const warmer = new CacheWarmer();
    const direct = await warmer.warmUserData(u.userId);
    expect(Object.keys(direct.user).sort()).toEqual(PUBLIC_COLUMNS);
    expect(Object.keys(JSON.parse(await redis.get(`user:${u.userId}`))).sort()).toEqual(PUBLIC_COLUMNS);

    const prev = app.get('cacheWarmer');
    app.set('cacheWarmer', warmer);
    try {
      const res = await request(app).post('/api/optimization/cache/warm-user')
        .set('Authorization', `Bearer ${u.token}`).send({ userId: u.userId });
      expect(res.status).toBe(200);
      expect(res.body.result.user.id).toBe(u.userId);
      expect(res.body.result.user).not.toHaveProperty('password');
      expect(res.body.result.user).not.toHaveProperty('phone');
    } finally { app.set('cacheWarmer', prev); }
  });

  // 测试环境 utils/cache 未配置 Redis（直查库），这里只兜底确认对外响应不含敏感字段；
  // 缓存值形状一致性由上面的 USER_CACHE_COLUMNS 断言保证（两边共用同一份列清单）。
  test('用户详情接口不返回 password/phone', async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    await new CacheWarmer().warmUserData(owner.userId);
    const res = await request(app).get(`/api/users/${owner.userId}`).set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.id || res.body.user?.id).toBe(owner.userId);
    expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    expect(JSON.stringify(res.body)).not.toContain(owner.phone);
  });
});

describe('purgeLegacySensitiveUserKeys：一次性清理旧版写入的敏感 user:<id>', () => {
  const legacyRow = JSON.stringify({ id: 'a', username: 'alice', phone: '+86-13800000000', password: '$2a$10$hash', avatar: '' });
  const safeRow = JSON.stringify({ id: 'b', username: 'bob', avatar: '', bio: '', status: 'online', wechat_id: '', cover_photo: '' });

  function seed() {
    return {
      'user:a': legacyRow,
      'user:b': safeRow,
      'user:c': JSON.stringify({ id: 'c', phone: '+86-13900000000' }),   // 只有 phone 也算敏感
      'user:search:a:hello': '3',            // searchRanking 计数，必须保留
      'user:a:conversations': JSON.stringify([{ id: 'conv', password: 'x' }]),   // 非 user:<id> 形态，不碰
      'user:42': '17',                       // 计数器类字符串值，不碰
      'group:g1': JSON.stringify({ id: 'g1' }),
    };
  }

  test('只删含 password/phone 的 user:<id>，写标记；再次执行为空操作', async () => {
    const r = fakeRedis(seed());
    const warmer = new CacheWarmer();
    const res = await warmer.purgeLegacySensitiveUserKeys(r);
    expect(res).toEqual({ checked: 4, deleted: 2 });
    expect([...r.store.keys()].sort()).toEqual([
      CacheWarmer.LEGACY_USER_PURGE_MARKER, 'group:g1', 'user:42', 'user:a:conversations', 'user:b', 'user:search:a:hello',
    ].sort());
    expect(r.calls.scan).toBeGreaterThan(1);   // 走了多页游标

    // 幂等：标记存在 → 不再扫描、不再删除
    r.store.set('user:z', legacyRow);
    const scansBefore = r.calls.scan;
    expect(await warmer.purgeLegacySensitiveUserKeys(r)).toEqual({ skipped: 'already-done' });
    expect(r.calls.scan).toBe(scansBefore);
    expect(r.store.has('user:z')).toBe(true);
  });

  test('没有 Redis 客户端 → 跳过；SCAN 失败 → 不写标记，下次重试', async () => {
    const warmer = new CacheWarmer();
    expect(await warmer.purgeLegacySensitiveUserKeys(null)).toEqual({ skipped: 'no-redis' });
    expect(await warmer.purgeLegacySensitiveUserKeys({ get: async () => null })).toEqual({ skipped: 'no-redis' });

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const broken = fakeRedis(seed(), { failScan: true });
      const res = await warmer.purgeLegacySensitiveUserKeys(broken);
      expect(res.error).toMatch(/synthetic/);
      expect(broken.store.has(CacheWarmer.LEGACY_USER_PURGE_MARKER)).toBe(false);
      expect(broken.store.has('user:a')).toBe(true);
    } finally { warn.mockRestore(); }
  });

  test('isLegacySensitiveUserValue 只认 JSON 对象里的敏感字段', () => {
    const f = CacheWarmer.isLegacySensitiveUserValue;
    expect(f(legacyRow)).toBe(true);
    expect(f(safeRow)).toBe(false);
    expect(f('17')).toBe(false);
    expect(f('{not json')).toBe(false);
    expect(f(null)).toBe(false);
    expect(f(JSON.stringify({ username: 'password' }))).toBe(false);
  });
});

