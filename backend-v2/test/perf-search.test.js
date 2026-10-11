'use strict';
/**
 * 搜索排名的 Redis 用法（2026-10-11）。
 *
 * 修复前：
 *   · recordUserSearch / recordSearch 把毫秒常量（30 * 86400000 / 7 * 86400000）传给 EXPIRE，
 *     而 EXPIRE 的单位是秒，TTL 实际约 82 年 / 19 年——每个不同的搜索词都在 db5 留下一个
 *     永不过期的 key（生产 Redis 无 maxmemory、noeviction）。
 *   · getSearchSuggestions 用 KEYS user:search:<uid>:* 取建议，KEYS 会阻塞地扫完整个 db5。
 * 修复后 EXPIRE 传秒数；建议改用 SCAN 游标分批遍历，客户端没有 scan（测试 mock / 无 Redis
 * 的 no-op 降级）时退回 keys，行为不变。
 */
require('./testEnv');

const RANKING_PATH = '../src/utils/searchRanking';
const DAY_S = 86400;

/** 用一个假 redis 替换掉真实模块（searchRanking 在 require 时就解构拿到 redis） */
function mockRedis(fake) {
  jest.resetModules();
  jest.doMock('../src/utils/redis', () => ({ redis: fake }));
  return require(RANKING_PATH);
}

/** 不 mock：测试环境没有 REDIS_URL，utils/redis 返回内存 mock（没有 scan） */
function realRedis() {
  jest.resetModules();
  jest.dontMock('../src/utils/redis');
  return require(RANKING_PATH);
}

describe('SearchRanking 的 Redis TTL 与建议遍历', () => {
  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });
  afterAll(() => { jest.dontMock('../src/utils/redis'); });

  test('recordUserSearch 的 EXPIRE 以秒为单位：30 天', async () => {
    const fake = { incr: jest.fn(async () => 1), expire: jest.fn(async () => 1) };
    const SearchRanking = mockRedis(fake);
    await new SearchRanking().recordUserSearch('u1', 'Hello');
    expect(fake.incr).toHaveBeenCalledWith('user:search:u1:hello');
    expect(fake.expire).toHaveBeenCalledWith('user:search:u1:hello', 30 * DAY_S);
  });

  test('recordSearch 的 EXPIRE 以秒为单位：7 天', async () => {
    const fake = { incr: jest.fn(async () => 1), expire: jest.fn(async () => 1) };
    const SearchRanking = mockRedis(fake);
    await new SearchRanking().recordSearch('Hello');
    expect(fake.expire).toHaveBeenCalledWith('search:query:hello', 7 * DAY_S);
  });

  test('时间新鲜度仍按毫秒计算（DAY 常量未被改成秒）', () => {
    const SearchRanking = mockRedis({});
    const ranking = new SearchRanking();
    expect(ranking.calcRecencyScore({ created_at: Date.now() - 2 * 86400000 })).toBe(80);
    expect(ranking.calcRecencyScore({ created_at: Date.now() - 10 * 86400000 })).toBe(40);
  });

  test('搜索建议用 SCAN 走完所有游标页、去重，不再调用 KEYS', async () => {
    const store = new Map([
      ['user:search:u1:hello', '5'],
      ['user:search:u1:help', '3'],
      ['user:search:u1:hey', '1'],
      ['user:search:u1:other', '9'],
    ]);
    const fake = {
      get: jest.fn(async key => (store.has(key) ? store.get(key) : null)),
      keys: jest.fn(async () => { throw new Error('KEYS 不应再被调用'); }),
      scan: jest.fn()
        .mockResolvedValueOnce(['17', ['user:search:u1:hello', 'user:search:u1:other']])
        .mockResolvedValueOnce(['42', ['user:search:u1:help', 'user:search:u1:hello']]) // SCAN 允许重复返回
        .mockResolvedValueOnce(['0', ['user:search:u1:hey']]),
    };
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const SearchRanking = mockRedis(fake);

    const suggestions = await new SearchRanking().getSearchSuggestions('u1', 'He');

    expect(suggestions).toEqual([
      { query: 'hello', count: 5 },
      { query: 'help', count: 3 },
      { query: 'hey', count: 1 },
    ]);
    expect(fake.keys).not.toHaveBeenCalled();
    expect(fake.scan.mock.calls.map(c => c[0])).toEqual(['0', '17', '42']);
    for (const call of fake.scan.mock.calls) {
      expect(call.slice(1, 4)).toEqual(['MATCH', 'user:search:u1:*', 'COUNT']);
      expect(call[4]).toBeGreaterThan(0);
    }
    expect(fake.get).toHaveBeenCalledTimes(3); // 重复的 hello 只 GET 一次，other 前缀不符不 GET
    expect(log).not.toHaveBeenCalled();
  });

  test('SCAN 中途失败时返回空数组（与原来 KEYS 失败时一致）', async () => {
    const fake = {
      get: jest.fn(async () => '1'),
      scan: jest.fn()
        .mockResolvedValueOnce(['5', ['user:search:u1:hello']])
        .mockRejectedValueOnce(new Error('Connection is closed.')),
    };
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const SearchRanking = mockRedis(fake);
    expect(await new SearchRanking().getSearchSuggestions('u1', 'he')).toEqual([]);
    expect(log).toHaveBeenCalledWith('[Ranking] 获取建议失败:', 'Connection is closed.');
  });

  test('客户端没有 scan 时退回 keys（测试 mock / no-op 降级）', async () => {
    const fake = {
      get: jest.fn(async () => '2'),
      keys: jest.fn(async () => ['user:search:u1:hello']),
    };
    const SearchRanking = mockRedis(fake);
    expect(await new SearchRanking().getSearchSuggestions('u1', 'he')).toEqual([{ query: 'hello', count: 2 }]);
    expect(fake.keys).toHaveBeenCalledWith('user:search:u1:*');
  });

  test('无 Redis 的测试环境：记录与建议照常工作，且只返回本人的搜索词', async () => {
    const SearchRanking = realRedis();
    const ranking = new SearchRanking();
    await ranking.recordUserSearch('perf-search-u1', 'Hello');
    await ranking.recordUserSearch('perf-search-u1', 'hello');
    await ranking.recordUserSearch('perf-search-u2', 'help');
    expect(await ranking.getSearchSuggestions('perf-search-u1', 'he')).toEqual([{ query: 'hello', count: 2 }]);
  });
});
