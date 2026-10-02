import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_CALL_EVENT, isDesktopCallActive, setDesktopCallActive } from './desktopCallState';

// vitest 环境为 node：用 EventTarget 充当 window（Node ≥19 自带 CustomEvent）
describe('setDesktopCallActive', () => {
  beforeEach(() => { vi.stubGlobal('window', new EventTarget()); });
  afterEach(() => {
    setDesktopCallActive('a', false);
    setDesktopCallActive('b', false);
    vi.unstubAllGlobals();
  });

  it('只在汇总状态变化时通知主进程与页面', () => {
    const setInCall = vi.fn().mockResolvedValue(undefined);
    window.electronAPI = { setInCall };
    const events = [];
    const onEvent = e => events.push(e.detail);
    window.addEventListener(DESKTOP_CALL_EVENT, onEvent);

    setDesktopCallActive('a', true);
    setDesktopCallActive('b', true);
    setDesktopCallActive('a', false);
    expect(isDesktopCallActive()).toBe(true);
    setDesktopCallActive('b', false);
    window.removeEventListener(DESKTOP_CALL_EVENT, onEvent);

    expect(setInCall.mock.calls).toEqual([[true], [false]]);
    expect(events).toEqual([true, false]);
    expect(isDesktopCallActive()).toBe(false);
  });

  it('非 Electron 环境（无 electronAPI）不报错', () => {
    expect(() => setDesktopCallActive('a', true)).not.toThrow();
    expect(isDesktopCallActive()).toBe(true);
  });

  it('旧版桌面壳 setInCall 抛错/拒绝时静默', async () => {
    window.electronAPI = { setInCall: vi.fn().mockRejectedValue(new Error('no handler')) };
    expect(() => setDesktopCallActive('a', true)).not.toThrow();
    await Promise.resolve();
  });
});
