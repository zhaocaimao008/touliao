import { describe, test, expect } from 'vitest';
import { validateScheduleTime, datetimeLocalToUnix, defaultScheduleLocal, scheduleBounds, scheduleTimeError, SCHEDULE_MIN_DELTA, SCHEDULE_MAX_DELTA } from './scheduleSend';

const NOW = 1700000000; // 固定基准秒

describe('validateScheduleTime', () => {
  test('合法：15 分钟后', () => {
    const r = validateScheduleTime(NOW + SCHEDULE_MIN_DELTA + 10, NOW);
    expect(r.ok).toBe(true);
  });
  test('合法：1 小时后', () => {
    expect(validateScheduleTime(NOW + 3600, NOW).ok).toBe(true);
  });
  test('合法：恰好 30 天后', () => {
    expect(validateScheduleTime(NOW + SCHEDULE_MAX_DELTA, NOW).ok).toBe(true);
  });
  test('非法：少于 15 分钟（14 分钟后）', () => {
    const r = validateScheduleTime(NOW + 14 * 60, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
  test('非法：超过 30 天', () => {
    const r = validateScheduleTime(NOW + SCHEDULE_MAX_DELTA + 1, NOW);
    expect(r.ok).toBe(false);
  });
  test('非法：NaN', () => {
    expect(validateScheduleTime(NaN, NOW).ok).toBe(false);
  });
  test('非法：过去时间', () => {
    expect(validateScheduleTime(NOW - 1, NOW).ok).toBe(false);
  });
});

describe('datetimeLocalToUnix', () => {
  test('有效字符串转换为 UNIX 秒', () => {
    const result = datetimeLocalToUnix('2024-01-01T12:00');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });
  test('无效字符串返回 null', () => {
    expect(datetimeLocalToUnix('')).toBeNull();
    expect(datetimeLocalToUnix('not-a-date')).toBeNull();
    expect(datetimeLocalToUnix(null)).toBeNull();
  });
});

describe('defaultScheduleLocal', () => {
  test('默认时间在当前 1 小时后（±5 分钟内）', () => {
    const now = new Date();
    const result = defaultScheduleLocal(now);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const ms = new Date(result).getTime();
    const diff = ms - (now.getTime() + 60 * 60 * 1000);
    expect(Math.abs(diff)).toBeLessThan(5 * 60 * 1000);
  });
});

test.each(['2025-02-29T10:00','2024-02-31T10:00','2026-13-01T10:00','2026-01-01T25:00','2026-01-01T10:00:30'])('rejects normalized or non-minute date %s',value=>{
  expect(datetimeLocalToUnix(value)).toBeNull();
});
test('minute bounds stay within the backend range without mutating the input date',()=>{
  const now=new Date('2030-06-01T10:00:59Z').getTime();const bounds=scheduleBounds(now);
  expect(datetimeLocalToUnix(bounds.min)-Math.floor(now/1000)).toBeGreaterThanOrEqual(SCHEDULE_MIN_DELTA);
  expect(datetimeLocalToUnix(bounds.max)-Math.floor(now/1000)).toBeLessThanOrEqual(SCHEDULE_MAX_DELTA);
  expect(scheduleTimeError(bounds.min,Math.floor(now/1000))).toBe('');
  expect(scheduleTimeError('',Math.floor(now/1000))).toBe('ss.errInvalidTime');
});
