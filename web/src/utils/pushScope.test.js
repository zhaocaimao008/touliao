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
test('push registrations never land on the root scope that the retired /sw.js owns', () => {
  // Registering /push-sw.js at '/' would replace the legacy root registration's script,
  // so the retirement worker (public/sw.js) would never run there.
  for (const windowId of ['', '00000000-0000-4000-8000-000000000000']) {
    vi.stubGlobal('sessionStorage', { getItem: () => windowId });
    expect(new URL(pushScope({ id: '7f1c2a9e-5b1d-4c3e-9a8f-0d6e2b4c1a7f', sessionId: 'b3e1f0c2-6d4a-4f8e-8c2b-9a7d5e3f1b0c' }), 'https://app.test/').pathname)
      .toMatch(/^\/push\/[^/]+\/[^/]+\/[^/]+\/$/);
    for (const id of ['', '.', '..', '/', '../..', '%2e%2e']) {
      for (const sessionId of [undefined, '', '..']) {
        expect(new URL(pushScope({ id, sessionId }), 'https://app.test/').pathname).not.toBe('/');
      }
    }
  }
});
test('a notification cannot open in the wrong account, session or window', () => {
  vi.stubGlobal('sessionStorage', { getItem: () => 'window-A' });
  const user = { id: 'A', sessionId: 'session-A' };
  const data = { recipientId: 'A', sessionId: 'session-A', windowId: 'window-A' };
  expect(matchesPushTarget(data, user)).toBe(true);
  for (const field of Object.keys(data)) expect(matchesPushTarget({ ...data, [field]: 'wrong' }, user)).toBe(false);
  expect(matchesPushTarget({}, user)).toBe(false);
});
