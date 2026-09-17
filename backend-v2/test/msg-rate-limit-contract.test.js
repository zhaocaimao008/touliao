'use strict';
/**
 * send_message 限流的客户端契约（2026-09-05 审计后新增）。
 *
 * 背景：客户端断线重连自愈以 120ms 间隔重发失败消息（≈8.3 条/秒），
 * 而服务端逐用户限流是 3 条/秒（config.limits.msgRateLimit）。实测 8 条排队消息
 * 只有 3 条发得出去，其余 5 条被判「失败」退回 error 态——而 UI 还在提示
 * 「正在重发 8 条」。用户要反复切走再切回会话，每轮只能再抢救 3 条。
 *
 * 修复方式不是把客户端间隔调慢（阈值是服务端配置，两边各写一份迟早又对不上），
 * 而是让服务端把「什么时候能再试」告诉客户端：
 *     { success:false, code:'RATE_LIMITED', retryAfterMs:<ms> }
 * 客户端据此保持「发送中」并自动退避重发（clientMsgId 不变，后端幂等去重）。
 *
 * 本用例锁住这个契约。它是纯服务端契约测试，不依赖客户端实现。
 */
require('./testEnv');
const presence = require('../src/realtime/presence');
const config = require('../src/config');

describe('checkMsgRate 契约', () => {
  const uid = () => 'rate-' + Math.random().toString(36).slice(2, 10);

  test('窗口内额度用尽前返回 { ok: true }', () => {
    const u = uid();
    for (let i = 0; i < config.limits.msgRateLimit; i += 1) {
      expect(presence.checkMsgRate(u)).toEqual({ ok: true });
    }
  });

  test('超出额度返回 ok:false 且带正数 retryAfterMs', () => {
    const u = uid();
    for (let i = 0; i < config.limits.msgRateLimit; i += 1) presence.checkMsgRate(u);
    const r = presence.checkMsgRate(u);
    expect(r.ok).toBe(false);
    expect(typeof r.retryAfterMs).toBe('number');
    expect(r.retryAfterMs).toBeGreaterThan(0);
    // 必须落在窗口长度内——否则客户端会退避过久，消息看起来"卡住"
    expect(r.retryAfterMs).toBeLessThanOrEqual(config.limits.msgRateWindow);
  });

  test('retryAfterMs 随时间递减（是"还要等多久"，不是固定值）', async () => {
    const u = uid();
    for (let i = 0; i < config.limits.msgRateLimit; i += 1) presence.checkMsgRate(u);
    const first = presence.checkMsgRate(u).retryAfterMs;
    await new Promise(r => setTimeout(r, 120));
    const second = presence.checkMsgRate(u).retryAfterMs;
    expect(second).toBeLessThan(first);
  });

  test('等满 retryAfterMs 之后必定放行——保证客户端退避一定能成功', async () => {
    const u = uid();
    for (let i = 0; i < config.limits.msgRateLimit; i += 1) presence.checkMsgRate(u);
    const r = presence.checkMsgRate(u);
    expect(r.ok).toBe(false);
    await new Promise(res => setTimeout(res, r.retryAfterMs + 30));
    expect(presence.checkMsgRate(u)).toEqual({ ok: true });
  });

  test('不同用户互不影响（限流是逐用户的）', () => {
    const a = uid(), b = uid();
    for (let i = 0; i < config.limits.msgRateLimit + 2; i += 1) presence.checkMsgRate(a);
    expect(presence.checkMsgRate(b)).toEqual({ ok: true });
  });

  test('返回值必须是对象而非布尔——防止有人改回 truthy 判断', () => {
    // 旧实现返回 boolean，调用方写的是 if (!checkMsgRate(...))。
    // 若有人改回布尔，{ok:false} 这种对象在旧写法下恒为 truthy，限流会整个失效。
    const r = presence.checkMsgRate(uid());
    expect(typeof r).toBe('object');
    expect(r).toHaveProperty('ok');
  });
});
