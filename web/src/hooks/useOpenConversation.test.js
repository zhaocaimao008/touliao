import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { useOpenConversation } from './useOpenConversation';
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

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const unmount = () => hooks.slots.forEach(slot => slot?.cleanup?.());
let onOpen, viewKey;
const alice = { id: 'alice', username: 'Alice', remark: 'Partner', avatar: 'avatar.png' };
function render() {
  hooks.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Controlled hook scheduling for asynchronous regression tests.
  const result = useOpenConversation(onOpen, viewKey);
  hooks.effects.splice(0).forEach(effect => effect());
  return result;
}
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.owner = 1;
  onOpen = vi.fn(); viewKey = 'query-A';
  vi.spyOn(axios, 'post').mockResolvedValue({ data: { conversationId: 'private-1' } });
  vi.spyOn(axios, 'get').mockResolvedValue({ data: { conversationId: 'helper-1' } });
});
afterEach(() => { unmount(); vi.restoreAllMocks(); });

test('same-result rapid clicks share one request and retain peer identity', async () => {
  const response = deferred(); axios.post.mockReturnValueOnce(response.promise);
  const first = render().openContact(alice); await render().openContact(alice);
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(render().openingKey).toBe('contact:alice'); expect(onOpen).not.toHaveBeenCalled();
  expect(axios.post.mock.calls[0][2]._sessionContext).toEqual({ owner: 1 });
  response.resolve({ data: { conversationId: 'c1' } }); await first;
  expect(onOpen).toHaveBeenCalledExactlyOnceWith({ id: 'c1', type: 'private', name: 'Partner', avatar: 'avatar.png', otherUser: alice });
  expect(render().openingKey).toBeNull();
});
test.each(['success', 'failure'])('selecting another result supersedes an older %s', async outcome => {
  const older = deferred(), newer = deferred();
  axios.post.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const first = render().openContact(alice), second = render().openContact({ id: 'bob', username: 'Bob' });
  expect(axios.post.mock.calls[0][2].signal.aborted).toBe(true);
  newer.resolve({ data: { conversationId: 'bob-chat' } }); await second;
  if (outcome === 'success') older.resolve({ data: { conversationId: 'alice-chat' } }); else older.reject(new Error('offline'));
  await first;
  expect(onOpen).toHaveBeenCalledTimes(1); expect(onOpen.mock.calls[0][0].id).toBe('bob-chat'); expect(render().error).toBe(false);
});
test('failed open can be retried without losing its target, and retry feedback remains usable while pending', async () => {
  axios.post.mockRejectedValueOnce(new Error('offline'));
  await render().openContact(alice);
  expect(render().error).toBe(true); expect(onOpen).not.toHaveBeenCalled();
  const response = deferred(); axios.post.mockReturnValueOnce(response.promise);
  const retry = render().retry();
  expect(render()).toMatchObject({ error: false, openingKey: 'contact:alice' }); expect(render().retry).toBeTypeOf('function');
  response.resolve({ data: { conversationId: 'c1' } }); await retry;
  expect(onOpen).toHaveBeenCalledTimes(1); expect(render()).toMatchObject({ error: false, openingKey: null });
});
test.each([{}, { conversationId: null }, { conversationId: '' }, { conversationId: '__file-helper__' }])('invalid response %j stays in the current view with retry feedback', async data => {
  axios.post.mockResolvedValueOnce({ data }); await render().openContact(alice);
  expect(onOpen).not.toHaveBeenCalled(); expect(render().error).toBe(true);
});
test.each(['unmount', 'account', 'query', 'query-roundtrip'])('%s prevents a late navigation', async change => {
  const response = deferred(); axios.post.mockReturnValueOnce(response.promise);
  const task = render().openContact(alice);
  if (change === 'unmount') unmount();
  else if (change === 'account') hooks.owner++;
  else { viewKey = 'query-B'; render(); if (change === 'query-roundtrip') { viewKey = 'query-A'; render(); } }
  response.resolve({ data: { conversationId: 'old-chat' } }); await task;
  expect(onOpen).not.toHaveBeenCalled(); expect(render().error).toBe(false);
  if (change !== 'account') expect(render().openingKey).toBeNull();
});
test('leaving a failed search and returning clears its stale retry', async () => {
  axios.post.mockRejectedValueOnce(new Error('offline')); await render().openContact(alice);
  const oldRetry = render().retry;
  viewKey = 'query-B'; render(); await oldRetry(); expect(axios.post).toHaveBeenCalledTimes(1);
  viewKey = 'query-A'; render(); expect(render().error).toBe(false); expect(render().retry).toBeUndefined();
});
test.each([undefined, '__file-helper__'])('file helper resolves placeholder %s before navigation', async id => {
  const response = deferred(); axios.get.mockReturnValueOnce(response.promise);
  const task = render().openConversation({ id, type: 'filehelper', name: 'Files' });
  expect(onOpen).not.toHaveBeenCalled();
  expect(axios.get.mock.calls[0][0]).toBe('/api/messages/file-helper');
  response.resolve({ data: { conversationId: 'helper-1' } }); await task;
  expect(onOpen).toHaveBeenCalledExactlyOnceWith({ id: 'helper-1', type: 'filehelper', name: 'Files' });
});
test('selecting an existing conversation cancels a pending contact lookup', async () => {
  const response = deferred(); axios.post.mockReturnValueOnce(response.promise);
  const first = render().openContact(alice);
  const group = { id: 'group-1', type: 'group', name: 'Team', members: [{ id: 'alice' }] };
  await render().openConversation(group);
  response.resolve({ data: { conversationId: 'late' } }); await first;
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(group); expect(axios.get).not.toHaveBeenCalled();
});
test('two message selections in the same conversation retain the latest location', async () => {
  const first = render().openConversation({ id: 'group-1', scrollToId: 'message-1' });
  const second = render().openConversation({ id: 'group-1', scrollToId: 'message-2' });
  await Promise.all([first, second]);
  expect(onOpen).toHaveBeenCalledExactlyOnceWith({ id: 'group-1', scrollToId: 'message-2' });
});
test('AI contact names and peer ids survive conversation resolution', async () => {
  await render().openContact({ id: 'bot-1', name: 'Assistant' });
  expect(onOpen.mock.calls[0][0]).toMatchObject({ name: 'Assistant', otherUser: { id: 'bot-1', username: 'Assistant' } });
});
