'use strict';
// Regression: RateLimiter 的 5 分钟 cleanup interval 不得让 Node event loop 保持 referenced。
// failing-first:修复前该 interval 的 hasRef() === true ⇒ 第三个 test 失败。

describe('RateLimiter cleanup interval lifecycle', () => {
  let captured;
  let realSetInterval;
  let realClearInterval;
  let mod;

  beforeAll(() => {
    realSetInterval = global.setInterval;
    realClearInterval = global.clearInterval;
    captured = [];
    jest.spyOn(global, 'setInterval').mockImplementation((fn, ms, ...args) => {
      const handle = realSetInterval(fn, ms, ...args);
      captured.push({ handle, ms: Number(ms), fn });
      return handle;
    });
    jest.resetModules();
    mod = require('../src/utils/rateLimiter');
  });

  afterAll(() => {
    jest.restoreAllMocks();
    for (const c of captured) { try { realClearInterval(c.handle); } catch (e) {} }
  });

  const fiveMinute = () => captured.filter(c => c.ms === 300000);

  test('creates the 5-minute cleanup interval', () => {
    const t = fiveMinute();
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t[0].ms).toBe(300000);
    expect(typeof t[0].fn).toBe('function');
  });

  test('the captured interval callback is the real cleanup (it purges stale entries)', () => {
    const t = fiveMinute();
    expect(t.length).toBeGreaterThanOrEqual(1);
    const limiter = mod.limiter;
    expect(limiter).toBeTruthy();
    limiter.requests.set('lifecycle-stale-key', [Date.now() - 2 * 3600 * 1000]);
    limiter.requests.set('lifecycle-fresh-key', [Date.now()]);
    t[0].fn();
    expect(limiter.requests.has('lifecycle-stale-key')).toBe(false);
    expect(limiter.requests.has('lifecycle-fresh-key')).toBe(true);
  });

  test('cleanup interval must not keep the event loop referenced', () => {
    const t = fiveMinute();
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t[0].handle.hasRef()).toBe(false);
  });
});
