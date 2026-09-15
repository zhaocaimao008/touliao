import { afterEach, expect, test, vi } from 'vitest';
import { pushScope, matchesPushTarget } from './pushScope';
afterEach(() => vi.unstubAllGlobals());
test('registrations differ between accounts, sessions and windows', () => {
  let windowId = '';
  vi.stubGlobal('sessionStorage', { getItem: () => windowId });
  const paths = new Set([pushScope({ id: 'A', sessionId: '1' }), pushScope({ id: 'B', sessionId: '2' }), pushScope({ id: 'A', sessionId: '3' })]);
  windowId = '00000000-0000-4000-8000-000000000000';
  paths.add(pushScope({ id: 'A', sessionId: '1' }));
  expect(paths.size).toBe(4);
});
test('a notification cannot open in the wrong account, session or window', () => {
  vi.stubGlobal('sessionStorage', { getItem: () => 'window-A' });
  const user = { id: 'A', sessionId: 'session-A' };
  const data = { recipientId: 'A', sessionId: 'session-A', windowId: 'window-A' };
  expect(matchesPushTarget(data, user)).toBe(true);
  for (const field of Object.keys(data)) expect(matchesPushTarget({ ...data, [field]: 'wrong' }, user)).toBe(false);
  expect(matchesPushTarget({}, user)).toBe(false);
});
