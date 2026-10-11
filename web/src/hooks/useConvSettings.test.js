import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { useConvSettings } from './useConvSettings';
import { publishConversationSettings } from '../utils/conversationSettings';

const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], owner: 1 }));
vi.mock('react', () => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => v !== b[i]);
  return {
    useState: initial => {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks.slots[i], value => { hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value; }];
    },
    useRef: initial => {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
      return hooks.slots[i];
    },
    useCallback: (fn, deps) => {
      const i = hooks.cursor++;
      if (changed(hooks.slots[i]?.deps, deps)) hooks.slots[i] = { fn, deps };
      return hooks.slots[i].fn;
    },
    useEffect: (fn, deps) => {
      const i = hooks.cursor++;
      if (!changed(hooks.slots[i]?.deps, deps)) return;
      hooks.effects.push(() => { hooks.slots[i]?.cleanup?.(); hooks.slots[i] = { deps, cleanup: fn() }; });
    },
  };
});
vi.mock('../utils/sessionContext', () => ({ captureSession: () => ({ owner: hooks.owner }), isSessionCurrent: scope => scope.owner === hooks.owner }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
vi.mock('../utils/conversationSettings', () => ({ publishConversationSettings: vi.fn() }));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const unmount = () => hooks.slots.forEach(slot => slot?.cleanup?.());
let conversation, onConvUpdate;
function render() {
  hooks.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Controlled hook scheduling for asynchronous regression tests.
  const result = useConvSettings(conversation, onConvUpdate);
  hooks.effects.splice(0).forEach(effect => effect());
  return result;
}
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.owner = 1;
  conversation = { id: 'c1', muted: 0, pinned: 0, burn_after: 0 }; onConvUpdate = vi.fn();
  publishConversationSettings.mockClear();
  vi.spyOn(axios, 'post').mockResolvedValue({ data: { success: true } });
});
afterEach(() => { unmount(); vi.restoreAllMocks(); });

test.each([
  ['toggleMute', true, 'muted', 1, 'mute'],
  ['togglePin', true, 'pinned', 1, 'pin'],
  ['changeBurnAfter', '60', 'burn_after', 60, 'burn-after'],
])('%s commits only after acknowledgement and shares the action lock', async (method, value, field, expected, endpoint) => {
  const request = deferred(); axios.post.mockReturnValue(request.promise);
  const task = render()[method](value);
  expect(render().saving).toBe(true); expect(onConvUpdate).not.toHaveBeenCalled();
  expect(render()).toMatchObject({ muted: false, pinned: false, burnAfter: 0 });
  await render()[method](value); await render().togglePin(true);
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][0]).toBe(`/api/messages/conversation/c1/${endpoint}`);
  request.resolve({ data: { success: true } }); await task;
  expect(onConvUpdate).toHaveBeenCalledExactlyOnceWith({ [field]: expected });
  expect(publishConversationSettings).toHaveBeenCalledExactlyOnceWith('c1', { [field]: expected }, { owner: 1 });
  expect(render().saving).toBe(false);
});
test('failed burn setting preserves last confirmed value and can be retried', async () => {
  conversation.burn_after = 30; axios.post.mockRejectedValueOnce(new Error('offline'));
  await render().changeBurnAfter('60');
  expect(render()).toMatchObject({ burnAfter: 30, saving: false, error: 'privateChat.saveFailed' });
  expect(onConvUpdate).not.toHaveBeenCalled();
  await render().changeBurnAfter('60');
  expect(render()).toMatchObject({ burnAfter: 60, error: '' });
  expect(onConvUpdate).toHaveBeenCalledExactlyOnceWith({ burn_after: 60 });
});
test('parent updates reconcile changed fields without losing a local acknowledgement', async () => {
  await render().togglePin(true);
  conversation = { ...conversation, muted: 1 };
  expect(render()).toMatchObject({ muted: true, pinned: true });
  conversation = { ...conversation, pinned: 1 }; render();
  conversation = { ...conversation, pinned: 0, burn_after: 300 };
  expect(render()).toMatchObject({ muted: true, pinned: false, burnAfter: 300 });
});
test.each(['invalid', '-1', '15', '0'])('invalid or unchanged burn value %s makes no request', async value => {
  await render().changeBurnAfter(value); expect(axios.post).not.toHaveBeenCalled();
});
test.each(['unmount', 'account', 'conversation'])('%s suppresses late setting success', async action => {
  const request = deferred(); axios.post.mockReturnValue(request.promise);
  const task = render().toggleMute(true);
  if (action === 'unmount') unmount();
  if (action === 'account') hooks.owner++;
  if (action === 'conversation') { conversation = { ...conversation, id: 'c2' }; render(); }
  request.resolve({ data: { success: true } }); await task;
  expect(onConvUpdate).not.toHaveBeenCalled(); expect(render().muted).toBe(false);
  if (action !== 'account') expect(axios.post.mock.calls[0][2].signal.aborted).toBe(true);
});
test('late failure from a previous conversation cannot change the new panel error or busy state', async () => {
  const old = deferred(), fresh = deferred(); axios.post.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const first = render().toggleMute(true);
  conversation = { ...conversation, id: 'c2' }; render();
  const second = render().togglePin(true);
  old.reject(new Error('offline')); await first;
  expect(render()).toMatchObject({ saving: true, error: '' });
  fresh.resolve({ data: { success: true } }); await second; expect(render().pinned).toBe(true);
});
test('confirmation locks other actions and cancellation never performs a request', async () => {
  const confirm = deferred(), request = vi.fn(), onSuccess = vi.fn();
  const task = render().runAction('clear', { confirm: () => confirm.promise, request, onSuccess });
  await render().toggleMute(true);
  expect(axios.post).not.toHaveBeenCalled(); expect(render().pending).toBe('clear');
  confirm.resolve(false); await task;
  expect(request).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled(); expect(render().saving).toBe(false);
});
test.each(['unmount', 'account'])('%s while confirming prevents the later destructive request', async action => {
  const confirm = deferred(), request = vi.fn();
  const task = render().runAction('clear', { confirm: () => confirm.promise, request });
  if (action === 'unmount') unmount(); else hooks.owner++;
  confirm.resolve(true); await task; expect(request).not.toHaveBeenCalled();
});
test('export requests share the same lock and late downloads are suppressed on close', async () => {
  const response = deferred(), request = vi.fn(() => response.promise), onSuccess = vi.fn();
  const action = { request, onSuccess, failureMessage: 'export failed' };
  const first = render().runAction('export', action); await render().runAction('export', action);
  expect(request).toHaveBeenCalledTimes(1); expect(render().pending).toBe('export');
  unmount(); expect(request.mock.calls[0][0].signal.aborted).toBe(true);
  response.resolve({ data: 'export' }); await first; expect(onSuccess).not.toHaveBeenCalled();
});
test('failed generic action keeps the panel open and successful retry clears the error', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: 'ok' }), onSuccess = vi.fn();
  const action = { request, onSuccess, failureMessage: 'export failed' };
  await render().runAction('export', action); expect(render().error).toBe('export failed'); expect(onSuccess).not.toHaveBeenCalled();
  await render().runAction('export', action); expect(render().error).toBe(''); expect(onSuccess).toHaveBeenCalledExactlyOnceWith({ data: 'ok' }, { owner: 1 });
});

test.each([{ success: false }, {}, { success: true, burn_after: 'invalid' }])('invalid acknowledgement %j does not commit a setting', async data => {
  axios.post.mockResolvedValue({ data }); await render().changeBurnAfter('60');
  expect(render()).toMatchObject({ burnAfter: 0, error: 'privateChat.saveFailed' });
  expect(onConvUpdate).not.toHaveBeenCalled();
});
test('burn setting displays the server-confirmed value', async () => {
  axios.post.mockResolvedValue({ data: { success: true, burn_after: 30 } }); await render().changeBurnAfter('60');
  expect(render().burnAfter).toBe(30); expect(onConvUpdate).toHaveBeenCalledExactlyOnceWith({ burn_after: 30 });
});
