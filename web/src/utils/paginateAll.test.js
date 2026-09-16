import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from './paginateAll';

describe('fetchAllPages', () => {
  it('stops after the first short page (single page under the limit)', async () => {
    const requestPage = vi.fn().mockResolvedValue([1, 2, 3]);
    const items = await fetchAllPages({ requestPage, limit: 100 });
    expect(items).toEqual([1, 2, 3]);
    expect(requestPage).toHaveBeenCalledTimes(1);
    expect(requestPage).toHaveBeenCalledWith(0, 100);
  });

  it('keeps requesting subsequent offsets while pages are full, and concatenates them in order', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => i),
      Array.from({ length: 100 }, (_, i) => 100 + i),
      Array.from({ length: 40 }, (_, i) => 200 + i),
    ];
    const requestPage = vi.fn((offset) => Promise.resolve(pages[offset / 100]));
    const items = await fetchAllPages({ requestPage, limit: 100 });
    expect(items).toHaveLength(240);
    expect(items[0]).toBe(0);
    expect(items[239]).toBe(239);
    expect(requestPage).toHaveBeenCalledTimes(3);
    expect(requestPage.mock.calls.map(c => c[0])).toEqual([0, 100, 200]);
  });

  it('stops exactly when a page length equals the limit but the next page is empty (1000-item boundary)', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => i),
      [],
    ];
    const requestPage = vi.fn((offset) => Promise.resolve(pages[offset / 100]));
    const items = await fetchAllPages({ requestPage, limit: 100 });
    expect(items).toHaveLength(100);
    expect(requestPage).toHaveBeenCalledTimes(2); // 必须再请求一次确认真的没有更多，不能凭 ===limit 就假设还有下一页
  });

  it('returns an empty list without requesting further pages when the very first page is empty', async () => {
    const requestPage = vi.fn().mockResolvedValue([]);
    const items = await fetchAllPages({ requestPage });
    expect(items).toEqual([]);
    expect(requestPage).toHaveBeenCalledTimes(1);
  });

  it('stops early when the signal is already aborted before the next request', async () => {
    const controller = new AbortController();
    const requestPage = vi.fn((offset) => {
      if (offset === 100) controller.abort();
      return Promise.resolve(Array.from({ length: 100 }, (_, i) => offset + i));
    });
    const items = await fetchAllPages({ requestPage, limit: 100, signal: controller.signal });
    expect(items).toHaveLength(200); // 第 3 次请求前发现已 abort，不再发出
    expect(requestPage).toHaveBeenCalledTimes(2);
  });
});
