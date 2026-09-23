import { expect, it } from 'vitest';
import { feedbackDuration } from './feedbackPolicy';

it('DS-024 gives feedback a readable duration, respects Unicode and bounds long messages', () => {
  expect(feedbackDuration('已保存', 'success')).toBe(4000);
  expect(feedbackDuration('下载失败', 'error')).toBe(4500);
  expect(feedbackDuration('中'.repeat(100))).toBe(8000);
  expect(feedbackDuration('🙂'.repeat(50))).toBe(4000);
  expect(feedbackDuration('中'.repeat(500), 'error')).toBe(12000);
});
