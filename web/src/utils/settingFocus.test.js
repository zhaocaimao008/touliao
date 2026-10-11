import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { keepSettingFocus } from './settingFocus';
let control, body, frame;
beforeEach(() => {
  control = { isConnected: true, disabled: false, focus: vi.fn() }; body = {};
  vi.stubGlobal('document', { activeElement: control, body });
  vi.stubGlobal('requestAnimationFrame', fn => { frame = fn; });
});
afterEach(() => vi.unstubAllGlobals());
test('lost focus returns after the pending control is enabled again', async () => {
  await keepSettingFocus(async () => { document.activeElement = body; });
  expect(control.focus).not.toHaveBeenCalled(); frame();
  expect(control.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
});
test.each(['moved', 'closed', 'disabled'])('does not steal focus when the user %s', async condition => {
  await keepSettingFocus(async () => { document.activeElement = body; });
  if (condition === 'moved') document.activeElement = {};
  if (condition === 'closed') control.isConnected = false;
  if (condition === 'disabled') control.disabled = true;
  frame(); expect(control.focus).not.toHaveBeenCalled();
});
