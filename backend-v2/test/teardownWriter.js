'use strict';
/**
 * GATE-JEST-EXIT 统一 teardown:关闭「已加载」的 DB writer Worker,消除其父侧 MessagePort 残留句柄。
 *
 * 规则(刻意保守):
 *  1. 只在 writer 模块已经出现在 require.cache 时才清理 —— 绝不为清理而 require 一个原本未加载的模块
 *     (那会新建 Worker,反而制造句柄)。用 require.resolve 取路径(仅解析、不加载),再查 require.cache。
 *  2. 调用前先把该模块**已导出的** shutdown 包一层「幂等 memo」:
 *     Jest 的 afterAll 按注册顺序执行,本钩子(来自 setupFilesAfterEnv)会先于测试文件自身的
 *     afterAll 运行;而 writer.shutdown() 是「等待 worker 'exit' 事件」的实现,事件只发生一次 ——
 *     若测试文件随后再调一次,旧实现会永久挂起(Exceeded timeout of 15000ms for a hook)。
 *     memo 包装让首次调用之后的任何调用复用同一个已 resolve 的 promise。
 *     包装仅作用于本进程内的模块实例,不修改生产源码与模块文件。
 *  3. 仅当进程内确实还存在 MessagePort 活跃资源时才真正调用(句柄已消失则跳过)。
 *  4. 等待有界 5s:超时即抛出错误,让套件明确失败并留下诊断,不静默吞掉。
 *  5. 不改动生产代码语义:只调用 writer 模块**已有的** shutdown()。
 */
const SHUTDOWN_TIMEOUT_MS = 5000;

let WRITER_PATH = null;
try {
  WRITER_PATH = require.resolve('../src/db/writer');
} catch {
  WRITER_PATH = null; // 模块不存在(裁剪环境)时不做任何事
}

function makeShutdownIdempotent(exportsObj) {
  const real = exportsObj.shutdown;
  if (!real || real.__r3TeardownWrapped) return real;
  let memo = null;
  const wrapped = function (...args) {
    if (!memo) {
      memo = Promise.resolve().then(() => real.apply(exportsObj, args));
      memo.catch(() => { memo = null; }); // 失败时不缓存,便于后续诊断重试
    }
    return memo;
  };
  Object.defineProperty(wrapped, '__r3TeardownWrapped', { value: true });
  try {
    exportsObj.shutdown = wrapped;
  } catch {
    /* 导出对象不可写时保持原函数 */
  }
  return exportsObj.shutdown;
}

afterAll(async () => {
  if (!WRITER_PATH) return;

  const cached = require.cache[WRITER_PATH];
  if (!cached || !cached.exports || typeof cached.exports.shutdown !== 'function') {
    return; // writer 未被本套件加载:不清理
  }

  const shutdown = makeShutdownIdempotent(cached.exports);
  if (typeof shutdown !== 'function') return;

  if (!process.getActiveResourcesInfo().includes('MessagePort')) {
    return; // writer Worker 已退出(或本进程已无该句柄):无需清理
  }

  let timer = null;
  try {
    await Promise.race([
      Promise.resolve(shutdown()),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(
            `[r3-teardown] writer.shutdown() 超过 ${SHUTDOWN_TIMEOUT_MS}ms 未完成:Worker 可能未退出`
          )),
          SHUTDOWN_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
});
