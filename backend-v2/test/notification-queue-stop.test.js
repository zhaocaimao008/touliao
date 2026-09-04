'use strict';
/**
 * 通知队列轮询的停止与失败上限（2026-09-04）。
 *
 * 加固前：startProcessing() 起的轮询没有任何停止手段，也没有失败上限。
 *   · graceful() 里 await redisCache.disconnect() 之后轮询还在跑，每 5 秒对着已 quit
 *     的客户端 rpop 一次，抛 "Connection is closed." 并以 **error** 级别写进
 *     error.log / Sentry。生产日志实测 57 条全是这个，全部产生在关停窗口
 *     （该服务重启过 163 次）。
 *   · Redis 真挂掉时同样会无休止刷下去，把真事故淹掉。
 *
 * 附带事实（不在本次改动范围，但值得记着）：NotificationQueue.enqueue() 全仓零调用方，
 * 也没人读 app.get('notificationQueue') —— 这个队列目前收不到任何东西，纯空转。
 */
require('./testEnv');

const QUEUE_PATH = '../src/modules/notifications/notificationQueue';

/** 用一个总是抛 "Connection is closed." 的假 redis 替换掉真实模块 */
function mockRedis(rpop) {
  jest.resetModules();
  jest.doMock('../src/utils/redis', () => ({ redis: { rpop, lpush: jest.fn() } }));
  return require(QUEUE_PATH);
}

const flush = (ms) => new Promise(r => setTimeout(r, ms));

describe('NotificationQueue 轮询', () => {
  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

  test('连续失败到上限后停止轮询，不再无休止重试', async () => {
    let calls = 0;
    const rpop = jest.fn(async () => { calls += 1; throw new Error('Connection is closed.'); });
    const NotificationQueue = mockRedis(rpop);
    // 失败重试间隔调到 1ms，让上限逻辑在测试里几毫秒内跑完
    const q = new NotificationQueue({ retryDelayMs: 1 });
    q.startProcessing();
    await flush(300);
    const settled = calls;
    expect(settled).toBeLessThanOrEqual(5);   // 上限 MAX_CONSECUTIVE_ERRORS
    expect(q.processing).toBe(false);          // 已自行停止
    await flush(200);
    expect(calls).toBe(settled);               // 停了就是停了，不再增加
  }, 15000);

  test('stop() 之后不再轮询（优雅退出路径）', async () => {
    let calls = 0;
    const rpop = jest.fn(async () => { calls += 1; return null; });  // 队列空
    const NotificationQueue = mockRedis(rpop);
    const q = new NotificationQueue({ idlePollMs: 5 });
    q.startProcessing();
    await flush(50);
    q.stop();
    const at = calls;
    await flush(200);                           // 远超 idlePollMs，停了就该一次都不再跑
    expect(calls).toBe(at);                     // stop 后一次都不该再跑
    expect(q.processing).toBe(false);
  }, 15000);

  test('stop() 之后再 startProcessing() 不会复活轮询', async () => {
    let calls = 0;
    const NotificationQueue = mockRedis(jest.fn(async () => { calls += 1; return null; }));
    const q = new NotificationQueue();
    q.stop();
    q.startProcessing();
    await flush(100);
    expect(calls).toBe(0);
  }, 15000);
});
