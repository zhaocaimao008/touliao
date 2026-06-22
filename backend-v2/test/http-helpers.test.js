'use strict';
/**
 * 单元测试：utils/http 的成功响应辅助（P2，201/204 + 列表分页元信息）。
 * 用最小 res 桩验证 helper 行为，不依赖 Express 路由。
 */

const { created, noContent, paginated } = require('../src/utils/http');

// 极简 res 桩：链式 status/set/json/end，记录调用
function mockRes() {
  return {
    statusCode: undefined,
    headers: {},
    body: undefined,
    ended: false,
    status(c) { this.statusCode = c; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    json(b) { this.body = b; return this; },
    end() { this.ended = true; return this; },
  };
}

describe('http.created (201)', () => {
  test('返回 201 并携带新资源', () => {
    const res = mockRes();
    created(res, { id: 'm1', content: 'hi' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: 'm1', content: 'hi' });
  });

  test('传入 location 时写 Location 头', () => {
    const res = mockRes();
    created(res, { id: 'm1' }, '/api/moments/m1');
    expect(res.statusCode).toBe(201);
    expect(res.headers.Location).toBe('/api/moments/m1');
  });

  test('不传 location 时不写 Location 头', () => {
    const res = mockRes();
    created(res, { id: 'm1' });
    expect(res.headers.Location).toBeUndefined();
  });
});

describe('http.noContent (204)', () => {
  test('返回 204 且无 body', () => {
    const res = mockRes();
    noContent(res);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
  });
});

describe('http.paginated', () => {
  test('total 已知：原样回传，hasMore 由 offset+本页 < total 判定', () => {
    const r = paginated([1, 2, 3], { total: 10, limit: 3, offset: 0 });
    expect(r).toEqual({ items: [1, 2, 3], total: 10, hasMore: true });
  });

  test('total 已知且已到末页：hasMore=false', () => {
    const r = paginated([8, 9, 10], { total: 10, limit: 3, offset: 7 });
    expect(r).toEqual({ items: [8, 9, 10], total: 10, hasMore: false });
  });

  test('total 未知 + 拿满一页：启发式 hasMore=true，total 兜底为 offset+本页', () => {
    const r = paginated([1, 2, 3], { limit: 3, offset: 6 });
    expect(r).toEqual({ items: [1, 2, 3], total: 9, hasMore: true });
  });

  test('total 未知 + 未拿满一页：hasMore=false', () => {
    const r = paginated([1, 2], { limit: 3, offset: 0 });
    expect(r).toEqual({ items: [1, 2], total: 2, hasMore: false });
  });

  test('total 未知 + 无 limit：保守 hasMore=false', () => {
    const r = paginated([1, 2, 3]);
    expect(r).toEqual({ items: [1, 2, 3], total: 3, hasMore: false });
  });

  test('items 非数组：归一为空列表', () => {
    const r = paginated(undefined, { total: 0, limit: 20, offset: 0 });
    expect(r).toEqual({ items: [], total: 0, hasMore: false });
  });

  test('负 offset 归零', () => {
    const r = paginated([1], { total: 5, limit: 1, offset: -3 });
    expect(r.hasMore).toBe(true); // 0 + 1 < 5
  });
});
