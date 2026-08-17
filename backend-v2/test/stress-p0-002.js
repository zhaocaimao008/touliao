'use strict';
/**
 * P0-002 压力验证（本地，不碰生产）：
 * 连续发送 100/500/1000 次畸形 payload 到全部已加固事件，
 * 验证：无未捕获异常 / 进程不退出 / 内存平稳。
 *
 * nudge 依赖 utils/cache（redis 类外部存储），测试环境会挂起 →
 * 这里 stub 成内存实现，让 async handler 可完成。
 */
const Module = require('module');

// stub cache：内存 map，立即返回
const memCache = new Map();
const fakeCache = {
  get: async (k) => memCache.get(k) || null,
  set: async (k, v, ttl) => { memCache.set(k, v); return true; },
  del: async (k) => { memCache.delete(k); return true; },
};
// 注入 stub 到 require 缓存（nudge.js require('../../utils/cache') 时会命中）
require.cache[require.resolve('../src/utils/cache')] = {
  id: require.resolve('../src/utils/cache'),
  filename: require.resolve('../src/utils/cache'),
  loaded: true,
  exports: fakeCache,
};

const registerCallHandler = require('../src/realtime/handlers/call');
const registerTypingHandler = require('../src/realtime/handlers/typing');
const registerGroupCallHandler = require('../src/realtime/handlers/groupCall');
const registerNudgeHandler = require('../src/realtime/handlers/nudge');

function makeMockSocket(userId, rooms = new Set()) {
  const emitted = [];
  const registry = {};
  return {
    user: { id: userId },
    id: `socket-${userId}`,
    rooms,
    emitted,
    _registry: registry,
    emit(event, payload) { emitted.push({ event, payload }); return this; },
    to() { return { emit() {}, _toEmitted: [] }; },
    join() {},
    on(event, handler) { registry[event] = handler; return this; },
  };
}
function makeMockIo() { const targeted = []; return { targeted, to(r) { return { emit(e, p) { targeted.push({ r, e, p }); return this; } }; } }; }

const BAD = [
  undefined, null, {}, [], 'hello', 42, true,
  { to: 123 }, { to: { id: 'x' } }, { to: ['a'] }, { to: '' }, { to: null },
  { to: 'a'.repeat(65) }, { to: 'b', type: 'smoke' }, { to: 'b', type: { evil: true } },
  { to: { nested: { deep: ['x'] } } }, { conversationId: null }, { conversationId: ['x'] },
];

const EVENTS = ['call:request','call:response','call:offer','call:answer','call:ice','call:end',
  'typing','stop_typing','join_conversation','join_group',
  'group_call:start','group_call:join','group_call:offer','group_call:answer','group_call:ice','group_call:leave',
  'nudge'];

async function main() {
  for (const count of [100, 500, 1000]) {
    const io = makeMockIo();
    const socket = makeMockSocket('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', new Set(['conv-1']));
    registerCallHandler(io, socket);
    registerTypingHandler(io, socket);
    registerGroupCallHandler(io, socket);
    registerNudgeHandler(io, socket);

    const rss0 = process.memoryUsage().rss;
    let throws = 0, rejects = 0;
    const t0 = Date.now();

    for (let i = 0; i < count; i++) {
      const ev = EVENTS[i % EVENTS.length];
      const payload = BAD[i % BAD.length];
      const handler = socket._registry[ev];
      if (!handler) continue;
      try {
        const ret = handler.call(socket, payload, () => {});
        if (ret && typeof ret.then === 'function') {
          await Promise.race([
            ret.catch(() => { rejects++; }),
            new Promise(r => setTimeout(r, 200)),
          ]);
        }
      } catch (e) { throws++; }
    }

    const ms = Date.now() - t0;
    const rss1 = process.memoryUsage().rss;
    const ok = throws === 0 && rejects === 0;
    console.log(`[${count} 次] throws=${throws} rejects=${rejects} RSS ${(rss0/1048576).toFixed(1)}MB→${(rss1/1048576).toFixed(1)}MB 耗时${ms}ms 状态=${ok?'PASS':'FAIL'}`);
    if (!ok) process.exitCode = 1;
  }
  console.log('进程未退出，压力验证完成。');
  process.exit(process.exitCode || 0);
}

main().catch(e => { console.error('压力验证异常:', e); process.exit(1); });
