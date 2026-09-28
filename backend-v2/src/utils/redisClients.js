'use strict';
/**
 * 进程内已打开的 Redis 客户端登记表（tokenBlacklist / utils/cache / 共享限流存储）。
 * 存在 globalThis 上：模块被重新加载（如测试里 jest.resetModules）产生的新实例也登记到同一处，
 * 收尾时能把所有实例的连接一起关掉——只按模块导出的 close() 关，会漏掉旧实例的连接。
 */
const KEY = '__touliaoRedisClients';
const clients = () => (globalThis[KEY] ||= new Set());

function track(client) {
  clients().add(client);
  return client;
}

async function closeAll() {
  const all = [...clients()];
  clients().clear();
  // 已就绪的优雅 quit；仍在建连/重连中的直接 disconnect（quit 对未就绪客户端不生效，连上后 socket 仍常驻）
  await Promise.all(all.map(c => {
    if (!c.isOpen) return Promise.resolve();
    return (c.isReady ? c.quit() : c.disconnect()).catch(() => c.disconnect?.().catch(() => {}));
  }));
}

module.exports = { track, closeAll };
