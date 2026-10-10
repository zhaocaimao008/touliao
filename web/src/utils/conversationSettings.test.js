import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { applyConversationSettings, publishConversationSettings, subscribeConversationSettings } from './conversationSettings';
const session = vi.hoisted(() => ({ owner: 1 }));
vi.mock('./sessionContext', () => ({ isSessionCurrent: scope => scope?.owner === session.owner }));
beforeEach(() => {
  session.owner = 1;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('CustomEvent', class extends Event { constructor(type, options) { super(type); this.detail = options.detail; } });
});
afterEach(() => vi.unstubAllGlobals());

test('one confirmed change reaches the list and active conversation snapshots', () => {
  let active = { id: 'a', pinned: 0 }, list = [active, { id: 'b', pinned: 0 }];
  const stopActive = subscribeConversationSettings(change => { active = applyConversationSettings(active, change); });
  const stopList = subscribeConversationSettings(change => { list = list.map(row => applyConversationSettings(row, change)); });
  publishConversationSettings('a', { pinned: 1 }, { owner: 1 });
  expect(active.pinned).toBe(1); expect(list.map(row => row.pinned)).toEqual([1, 0]);
  stopActive(); stopList();
});
test('old-account changes cannot reach the current account', () => {
  const listener = vi.fn(); subscribeConversationSettings(listener);
  session.owner = 2;
  publishConversationSettings('a', { muted: 1 }, { owner: 1 });
  window.dispatchEvent(new CustomEvent('touliao:conversation-settings', { detail: { conversationId: 'a', patch: { muted: 1 }, scope: { owner: 1 } } }));
  expect(listener).not.toHaveBeenCalled();
});
test('settings changes cannot replace conversation identity or unrelated fields', () => {
  const listener = vi.fn(); subscribeConversationSettings(listener);
  publishConversationSettings('a', { id: 'b', name: 'replaced', burn_after: 60 }, { owner: 1 });
  expect(listener).toHaveBeenCalledExactlyOnceWith({ conversationId: 'a', patch: { burn_after: 60 } });
});
test('unsubscribe and irrelevant changes leave existing state intact', () => {
  const listener = vi.fn(), stop = subscribeConversationSettings(listener);
  publishConversationSettings('a', { name: 'ignored' }, { owner: 1 }); stop();
  publishConversationSettings('a', { pinned: 1 }, { owner: 1 }); expect(listener).not.toHaveBeenCalled();
  const original = { id: 'other', pinned: 0 };
  expect(applyConversationSettings(original, { conversationId: 'a', patch: { pinned: 1 } })).toBe(original);
  expect(applyConversationSettings(null, { conversationId: 'a', patch: {} })).toBe(null);
});
