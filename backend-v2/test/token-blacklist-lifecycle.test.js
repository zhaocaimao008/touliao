'use strict';
// Regression: tokenBlacklist 的每小时 SQLite 清理 interval 不得让 Node event loop 保持 referenced。
// failing-first:修复前 hourly handle 的 hasRef() === true ⇒ 第二个 test 失败。

const mockClient = {
  on: jest.fn(),
  connect: jest.fn(async () => {}),
  setEx: jest.fn(async () => {}),
  exists: jest.fn(async () => 0),
};
jest.mock('redis', () => ({ createClient: () => mockClient }));

describe('tokenBlacklist hourly cleanup interval lifecycle', () => {
  let captured;
  let realSetInterval;
  let realClearInterval;

  beforeAll(() => {
    realSetInterval = global.setInterval;
    realClearInterval = global.clearInterval;
    process.env.REDIS_URL = 'redis://lifecycle-test.invalid';
    captured = [];
    jest.spyOn(global, 'setInterval').mockImplementation((fn, ms, ...args) => {
      const handle = realSetInterval(fn, ms, ...args);
      captured.push({ handle, ms: Number(ms), fn });
      return handle;
    });
    jest.resetModules();
    require('../src/utils/tokenBlacklist');
  });

  afterAll(() => {
    jest.restoreAllMocks();
    for (const c of captured) { try { realClearInterval(c.handle); } catch (e) {} }
    delete process.env.REDIS_URL;
  });

  test('schedules the hourly purge interval', async () => {
    await new Promise(r => setImmediate(r));
    const hourly = captured.filter(c => c.ms === 3600 * 1000);
    expect(hourly.length).toBeGreaterThanOrEqual(1);
    expect(typeof hourly[0].fn).toBe('function');
  });

  test('hourly purge interval must not keep the event loop referenced', async () => {
    await new Promise(r => setImmediate(r));
    const hourly = captured.filter(c => c.ms === 3600 * 1000);
    expect(hourly.length).toBeGreaterThanOrEqual(1);
    expect(hourly[0].handle.hasRef()).toBe(false);
  });
});
