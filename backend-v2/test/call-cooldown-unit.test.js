'use strict';
/**
 * 冷却原语回归（AUDIT 2026-09-07 P1-1：重拨覆盖可无限绕过 5s 防骚扰冷却）。
 * 直接断言 call.js 导出的 setCooldown/removeCooldown 语义（fake timers 免等真实 5s）：
 *   1. 冷却到期自动清除；
 *   2. set 前清旧 timer → 5s 整点边界旧定时器不得误删新记录；
 *   3. removeCooldown 同步清 map+timer，无残留定时器影响后续 set。
 * 处理器级"覆盖路径不再删除冷却"由代码审查 + 该语义组合保证（removeCooldown 仅
 * call:end/disconnect/超时收尾三处调用，重拨覆盖分支已移除 delete）。
 */
require('./testEnv');

const registerCallHandler = require('../src/realtime/handlers/call');

describe('callRateMap 冷却原语（防重拨绕过）', () => {
  const { setCooldown, removeCooldown, callRateMap, callRateTimers, CALL_COOLDOWN_MS } =
    registerCallHandler.cooldownInternals;

  beforeEach(() => {
    jest.useFakeTimers();
    callRateMap.clear();
    callRateTimers.clear();
  });
  afterEach(() => {
    callRateMap.clear();
    callRateTimers.clear();
    jest.useRealTimers();
  });

  test('默认冷却 5000ms；到期自动清除并清理定时器表', () => {
    expect(CALL_COOLDOWN_MS).toBe(5000);
    setCooldown('u1', 0);
    expect(callRateMap.has('u1')).toBe(true);
    jest.advanceTimersByTime(4999);
    expect(callRateMap.has('u1')).toBe(true);
    jest.advanceTimersByTime(1);
    expect(callRateMap.has('u1')).toBe(false);
    expect(callRateTimers.has('u1')).toBe(false);
  });

  test('边界竞态：新记录写入后，旧定时器不得删除它（AUDIT 误删场景）', () => {
    setCooldown('u2', 0);                 // t=0: 定时器拟在 t=5000 删
    jest.advanceTimersByTime(4999);       // t=4999: 恰好边界前重设（等价"新请求过了冷却窗口"）
    setCooldown('u2', 0);                 // 清旧 timer + 新 timer(t=9999)
    jest.advanceTimersByTime(2);          // t=5001: 若旧 timer 未被清，此刻已误删新记录
    expect(callRateMap.has('u2')).toBe(true);
    jest.advanceTimersByTime(4997);       // t=9998
    expect(callRateMap.has('u2')).toBe(true);
    jest.advanceTimersByTime(1);          // t=9999: 新 timer 到期
    expect(callRateMap.has('u2')).toBe(false);
  });

  test('removeCooldown 立即清空且无残留定时器影响后续 set', () => {
    setCooldown('u3', 0);
    removeCooldown('u3');
    expect(callRateMap.has('u3')).toBe(false);
    expect(callRateTimers.has('u3')).toBe(false);
    // 若 remove 忘了清 timer，残留定时器会在将来误删别的记录
    jest.advanceTimersByTime(5000);
    setCooldown('u3', 0);
    expect(callRateMap.has('u3')).toBe(true);
    jest.advanceTimersByTime(5000);
    expect(callRateMap.has('u3')).toBe(false); // 仅新 timer 到期删除，无重复删除异常
  });
});
