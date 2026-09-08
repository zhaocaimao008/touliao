import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { catchUpConversation } from './messageSync';
import { activateSession, captureSession, isSessionCurrent } from './sessionContext';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  const storage = new Map();
  vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
  activateSession('https://fixture.invalid', 'A');
});
afterEach(() => vi.unstubAllGlobals());

test.each([
  ['load', []],
  ['request', ['request:A:0']],
  ['apply', ['request:A:0', 'apply:1']],
  ['save', ['request:A:0', 'apply:1', 'save:A:1']],
  ['second-page', ['request:A:0', 'apply:1', 'save:A:1', 'request:A:1']],
])('account change during %s stops the remaining real sync pipeline', async (boundary, expected) => {
  const scope = captureSession();
  const gate = deferred();
  const begun = deferred();
  const events = [];
  const pause = async stage => { if (stage === boundary) { begun.resolve(); await gate.promise; } };
  const syncing = catchUpConversation({
    conversationId: 'same-group', accountId: 'A', isCurrent: () => isSessionCurrent(scope),
    loadCursor: async () => { await pause('load'); return 0; },
    requestPage: async (_conv, cursor) => {
      events.push(`request:${captureSession().accountId}:${cursor}`);
      await pause(cursor === 0 ? 'request' : 'second-page');
      return { next_cursor: cursor + 1, has_more: cursor === 0, messages: [cursor + 1] };
    },
    applyPage: async page => { events.push(`apply:${page[0]}`); await pause('apply'); },
    saveCursor: async (account, _conv, sequence) => { events.push(`save:${account}:${sequence}`); await pause('save'); },
  });
  await begun.promise;
  activateSession('https://fixture.invalid', 'B');
  gate.resolve();
  await syncing;
  expect(events).toEqual(expected);
});

test.each(['account-ABA', 'server', 'conversation', 'conversation-ABA'])('waiting cursor cannot revive after %s', async mode => {
  const scope = captureSession();
  let conversationGeneration = 0;
  const capturedConversation = conversationGeneration;
  const gate = deferred();
  const events = [];
  const syncing = catchUpConversation({
    conversationId: 'c1', accountId: 'A',
    isCurrent: () => isSessionCurrent(scope) && conversationGeneration === capturedConversation,
    loadCursor: () => gate.promise,
    requestPage: async () => { events.push('request'); return { next_cursor: 1, has_more: false, messages: [] }; },
    applyPage: async () => events.push('apply'), saveCursor: async () => events.push('save'),
  });
  if (mode.startsWith('conversation')) conversationGeneration += mode === 'conversation' ? 1 : 2;
  else if (mode === 'server') activateSession('https://other.invalid', 'A');
  else { activateSession('https://fixture.invalid', 'B'); activateSession('https://fixture.invalid', 'A'); }
  gate.resolve(0);
  await syncing;
  expect(events).toEqual([]);
});
