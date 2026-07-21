import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';   // 注入内存版 indexedDB
import { loadCache, saveCache, removeFromCache, clearCache, mergeById, __TESTING__ } from './msgCache';

const M = (id, over = {}) => ({ id, content: `c${id}`, created_at: id, ...over });

describe('msgCache（离线消息历史缓存）', () => {
  beforeEach(async () => { await clearCache(); });

  it('save → load 往返一致（升序）', async () => {
    await saveCache('c1', [M(2), M(1), M(3)]);
    const got = await loadCache('c1');
    expect(got.map(m => m.id)).toEqual([1, 2, 3]);
  });

  it('超过 50 条只留最近 50（按 created_at）', async () => {
    const many = Array.from({ length: 70 }, (_, i) => M(i + 1));
    await saveCache('c1', many);
    const got = await loadCache('c1');
    expect(got.length).toBe(__TESTING__.MAX_PER_CONV);
    expect(got[0].id).toBe(21);          // 最近 50 → id 21..70
    expect(got[got.length - 1].id).toBe(70);
  });

  it('按 id 去重（同 id 只留一条）', async () => {
    await saveCache('c1', [M(1), M(1, { content: 'dup' }), M(2)]);
    const got = await loadCache('c1');
    expect(got.map(m => m.id)).toEqual([1, 2]);
  });

  it('乐观消息(_tempId)不入缓存', async () => {
    await saveCache('c1', [M(1), { _tempId: 't1', content: 'x', created_at: 2 }]);
    const got = await loadCache('c1');
    expect(got.map(m => m.id)).toEqual([1]);
  });

  it('阅后即焚消息绝不落盘（隐私红线）', async () => {
    await saveCache('c1', [M(1), M(2, { burn_after: 1 }), M(3)]);
    const got = await loadCache('c1');
    expect(got.map(m => m.id)).toEqual([1, 3]);
  });

  it('remove 删除单条', async () => {
    await saveCache('c1', [M(1), M(2), M(3)]);
    await removeFromCache('c1', 2);
    expect((await loadCache('c1')).map(m => m.id)).toEqual([1, 3]);
  });

  it('clear(convId) 只清该会话', async () => {
    await saveCache('c1', [M(1)]);
    await saveCache('c2', [M(9)]);
    await clearCache('c1');
    expect(await loadCache('c1')).toEqual([]);
    expect((await loadCache('c2')).map(m => m.id)).toEqual([9]);
  });

  it('clear() 无参清全部（登出）', async () => {
    await saveCache('c1', [M(1)]);
    await saveCache('c2', [M(9)]);
    await clearCache();
    expect(await loadCache('c1')).toEqual([]);
    expect(await loadCache('c2')).toEqual([]);
  });

  it('save 空数组等价删除该会话键', async () => {
    await saveCache('c1', [M(1)]);
    await saveCache('c1', []);
    expect(await loadCache('c1')).toEqual([]);
  });

  it('未知/空 convId 安全（不抛错，返回空）', async () => {
    expect(await loadCache('')).toEqual([]);
    await expect(saveCache('', [M(1)])).resolves.toBeUndefined();
  });

  describe('mergeById（server 覆盖 cache）', () => {
    it('server 版本覆盖同 id 的旧缓存内容', () => {
      const cached = [M(1, { content: '旧' }), M(2)];
      const server = [M(1, { content: '新(已编辑)' }), M(3)];
      const merged = mergeById(cached, server);
      expect(merged.map(m => m.id)).toEqual([1, 2, 3]);
      expect(merged.find(m => m.id === 1).content).toBe('新(已编辑)');
    });
    it('合并后仍截断最近 50 并去乐观/焚毁', () => {
      const cached = Array.from({ length: 40 }, (_, i) => M(i + 1));
      const server = Array.from({ length: 40 }, (_, i) => M(i + 30, { burn_after: i === 0 ? 1 : 0 }));
      const merged = mergeById(cached, server);
      expect(merged.length).toBeLessThanOrEqual(50);
      expect(merged.every(m => !m.burn_after)).toBe(true);
    });
  });
});
