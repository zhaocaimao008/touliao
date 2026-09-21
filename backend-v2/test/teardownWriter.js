'use strict';
/**
 * GATE-JEST-EXIT 统一 teardown:关闭「已加载」的 DB writer Worker,消除其父侧 MessagePort 残留句柄。
 *
 * 规则(刻意保守):
 *  1. 只在 writer 模块已经出现在 require.cache 时才清理 —— 绝不为清理而 require 一个原本未加载的模块
 *     (那会新建 Worker,反而制造句柄)。用 require.resolve 取路径(仅解析、不加载),再查 require.cache。
 *  2. 只有当进程内确实还存在 MessagePort 活跃资源时才调用 shutdown();
 *     若测试文件已自行 shutdown(句柄已消失),直接跳过,避免二次 shutdown 永久等待。
 *  3. 等待必须有界:超时即抛出错误,让套件明确失败并留下诊断,不静默吞掉。
 *  4. 不改动生产代码语义:这里只调用 writer 模块**已有的** shutdown()。
 */
const SHUTDOWN_TIMEOUT_MS = 5000;

let WRITER_PATH = null;
try {
  WRITER_PATH = require.resolve('../src/db/writer');
} catch {
  WRITER_PATH = null; // 模块不存在(裁剪环境)时不做任何事
}

afterAll(async () => {
  if (!WRITER_PATH) return;

  const cached = require.cache[WRITER_PATH];
  if (!cached || !cached.exports || typeof cached.exports.shutdown !== 'function') {
    return; // writer 未被本套件加载:不清理
  }

  if (!process.getActiveResourcesInfo().includes('MessagePort')) {
    return; // writer Worker 已退出(或本进程已无该句柄):无需清理
  }

  let timer = null;
  try {
    await Promise.race([
      Promise.resolve(cached.exports.shutdown()),
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
