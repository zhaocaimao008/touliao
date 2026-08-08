import { describe, test, expect } from 'vitest';
import { isInQuietHours } from './quietHours';

// 固定某个时刻的 Date，便于断言
function at(h, m) { return new Date(2024, 0, 1, h, m, 0); }

describe('isInQuietHours 勿扰时段判定', () => {
  test('跨夜 23:00~07:00：23:30 命中', () => {
    expect(isInQuietHours('23:00', '07:00', at(23, 30))).toBe(true);
  });
  test('跨夜 23:00~07:00：凌晨 03:00 命中', () => {
    expect(isInQuietHours('23:00', '07:00', at(3, 0))).toBe(true);
  });
  test('跨夜 23:00~07:00：07:00 边界不命中（左闭右开）', () => {
    expect(isInQuietHours('23:00', '07:00', at(7, 0))).toBe(false);
  });
  test('跨夜 23:00~07:00：中午 12:00 不命中', () => {
    expect(isInQuietHours('23:00', '07:00', at(12, 0))).toBe(false);
  });
  test('当日 09:00~12:00：10:00 命中', () => {
    expect(isInQuietHours('09:00', '12:00', at(10, 0))).toBe(true);
  });
  test('当日 09:00~12:00：12:00 边界不命中', () => {
    expect(isInQuietHours('09:00', '12:00', at(12, 0))).toBe(false);
  });
  test('起止相同：永远 false', () => {
    expect(isInQuietHours('23:00', '23:00', at(23, 0))).toBe(false);
  });
  test('非法输入安全降级 false', () => {
    expect(isInQuietHours('25:00', '07:00', at(12, 0))).toBe(false);
    expect(isInQuietHours(null, '07:00', at(12, 0))).toBe(false);
    expect(isInQuietHours('9:0', '07:00', at(12, 0))).toBe(false);
  });
});
