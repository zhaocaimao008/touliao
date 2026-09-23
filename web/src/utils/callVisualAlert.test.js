import { afterEach, expect, test, vi } from 'vitest';
import { startCallVisualAlert, stopCallVisualAlert } from './callVisualAlert';
import { iconFavicon } from '../ui-kit/canvasIcon';

vi.mock('../ui-kit/canvasIcon', () => ({ iconFavicon: vi.fn(() => 'data:image/png;base64,fixture') }));

afterEach(() => {
  stopCallVisualAlert();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test('call alert uses the shared phone and restores the tab without duplicating timers', () => {
  vi.useFakeTimers();
  const favicon = { href: 'https://example.test/favicon.png' };
  vi.stubGlobal('document', { title: '投聊', querySelector: () => favicon });
  const original = favicon.href;
  startCallVisualAlert('林晓');
  startCallVisualAlert('重复事件');
  expect(iconFavicon).toHaveBeenCalledExactlyOnceWith('phone');
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(900);
  expect(document.title).toBe('林晓 来电 - 投聊');
  expect(favicon.href).toBe('data:image/png;base64,fixture');
  stopCallVisualAlert();
  expect(document.title).toBe('投聊');
  expect(favicon.href).toBe(original);
  expect(vi.getTimerCount()).toBe(0);
});
