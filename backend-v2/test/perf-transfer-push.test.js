'use strict';
/**
 * 2026-10-11：转账消息新接入离线推送后的两处配套——
 *   1. FCM 优先级：transfer 必须是 high，否则 Doze 中被延迟送达
 *   2. 正文本地化：按收件人语言给占位符，不把 content JSON / 金额推上锁屏
 */
const { messagePriority } = require('../src/utils/notificationPresentation');
const { bodyForMessage } = require('../src/utils/pushI18n');

describe('转账推送', () => {
  test('transfer 走 high 优先级；静默时段仍降为 normal', () => {
    expect(messagePriority('transfer')).toBe('high');
    expect(messagePriority('transfer', true)).toBe('normal');
  });

  test('正文按语言给占位符，不含 content 原文', () => {
    const content = JSON.stringify({ amount: 520, note: '房租', refId: 'r1' });
    expect(bodyForMessage('zh-CN', 'transfer', content)).toBe('[转账]');
    expect(bodyForMessage('en', 'transfer', content)).toBe('[Transfer]');
    expect(bodyForMessage('zh-TW', 'transfer', content)).toBe('[轉帳]');
    expect(bodyForMessage('xx', 'transfer', content)).toBe('[转账]');
  });
});
