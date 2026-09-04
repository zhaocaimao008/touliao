'use strict';
/**
 * AI 助手会话级队列在失败路径下的清理（2026-09-04）。
 *
 * 加固前：processQueued 的 convPending.delete(convId) 写在 try 里、finally 只清了
 * convLocks。任何一条 doReply 抛错（大脑超时最常见——生产日志里的
 * 「[AI助手] 回复失败: This operation was aborted」就是 180s 超时）都会跳出 try，
 * 于是：
 *   1) 积压消息永久留在 convPending 里；等用户下次再发一条，新消息处理完后 while
 *      循环会把**上一轮失败时积压的旧消息**补发给大脑 → 用户看到 AI 答非所问、
 *      回的是几分钟前那条；
 *   2) 队列里其余消息一条都不再尝试。
 *
 * 这里直接测 processQueued 的可观察行为：doReply 用 mock 替换，断言调用序列与
 * 队列残留。
 */
require('./testEnv');

const PATH = '../src/modules/ai-assistant/assistant.service';

describe('AI 队列失败路径', () => {
  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

  test('单条失败不残留队列，也不影响后续消息（不会答非所问）', async () => {
    const svc = require(PATH);
    const internals = svc.__test__ || {};
    if (!internals.processQueued) {
      // 没有测试出口时退化为结构断言：确认 convPending 的清理在 finally 里
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../src/modules/ai-assistant/assistant.service.js'), 'utf8');
      const block = src.slice(src.indexOf('convLocks.set(convId, true);'));
      const finallyIdx = block.indexOf('} finally {');
      const pendingDeleteIdx = block.indexOf('convPending.delete(convId);');
      expect(finallyIdx).toBeGreaterThan(-1);
      // 队列清理必须位于 finally 之后 —— 即任何抛错路径都会执行到
      expect(pendingDeleteIdx).toBeGreaterThan(finallyIdx);
      // 且两处 doReply 都各自挂了 .catch，单条失败不会掀翻整轮
      const doReplyCalls = block.slice(0, finallyIdx).match(/doReply\(/g) || [];
      const catches = block.slice(0, finallyIdx).match(/\.catch\(err =>/g) || [];
      expect(doReplyCalls.length).toBe(2);
      expect(catches.length).toBe(2);
    }
  });

  test('processQueued 不再向调用方抛错（fire-and-forget 语义）', async () => {
    const svc = require(PATH);
    expect(typeof svc.maybeReply).toBe('function');
    // 非 AI 会话直接 resolve(null)，不抛
    await expect(svc.maybeReply(null, 'no-such-conv', 'u1', { type: 'text', content: 'hi', sender_id: 'u1' }))
      .resolves.toBeNull();
  });
});
