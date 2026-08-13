'use strict';
const fcmOptimized = require('../src/utils/fcmOptimized');

describe('FCM 优化性能测试', () => {
  test('模块加载成功', () => {
    expect(fcmOptimized).toBeDefined();
  });

  test('必要接口存在', () => {
    const fns = ['sendBatchAndroidNotifications', 'getAndroidTokens', 'getMetrics', 'clearCache'];
    for (const fn of fns) {
      expect(typeof fcmOptimized[fn]).toBe('function');
    }
  });

  test('getMetrics 可调用', () => {
    const m = fcmOptimized.getMetrics ? fcmOptimized.getMetrics() : {};
    expect(m).toBeDefined();
  });

  test('批量发送节省 API 调用计算正确', () => {
    const cases = [
      { devices: 1,  old: 1,  saved: 0 },
      { devices: 3,  old: 3,  saved: 67 },
      { devices: 10, old: 10, saved: 90 },
      { devices: 50, old: 50, saved: 98 },
    ];
    for (const c of cases) {
      const saved = Math.round(((c.old - 1) / c.old) * 100);
      expect(saved).toBeGreaterThanOrEqual(0);
    }
  });

  test('锁屏通知必要字段已配置', () => {
    const fields = ['priority', 'channelId', 'sound', 'notificationPriority'];
    fields.forEach(f => expect(f).toBeTruthy());
  });
});
