'use strict';
/**
 * GATE-JEST-EXIT：套件结束时关闭本测试文件内打开过的所有 Redis 连接。
 * CI 为集成用例配置了 REDIS_URL，tokenBlacklist / utils/cache / 共享限流存储会建常驻连接；
 * 进程常驻的服务端不需要关，但 Jest 在去掉 --forceExit 后会因这些 socket 永远不退出。
 *  1. 先调用已加载模块的 close()：置「已关闭」标志，防止 utils/cache 之类在收尾期间懒重连；
 *  2. 再用 globalThis 登记表（src/utils/redisClients.js）兜底关闭其余连接——
 *     测试里 jest.resetModules() 之后旧模块实例不在 require.cache 里，只按模块关会漏。
 * 与 teardownWriter.js 同样保守：不为清理而加载业务模块。
 */
const MODULES = ['../src/utils/tokenBlacklist', '../src/utils/cache', '../src/middleware/rateLimiters'];

afterAll(async () => {
  for (const m of MODULES) {
    let p;
    try { p = require.resolve(m); } catch { continue; }
    const cached = require.cache[p];
    if (cached?.exports && typeof cached.exports.close === 'function') await cached.exports.close();
  }
  await require('../src/utils/redisClients').closeAll();
});
