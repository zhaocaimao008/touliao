import { afterEach, expect, test, vi } from 'vitest';
import { accountWindowId, clientStorage, initAccountWindow, isBearerClient } from './clientStorage';

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key), clear: () => data.clear(), key: i => [...data.keys()][i],
    get length() { return data.size; } };
}
afterEach(() => vi.unstubAllGlobals());

test('two window credentials do not touch each other or the shared browser storage', () => {
  const shared = storage(), a = storage(), b = storage();
  const idA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', idB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  vi.stubGlobal('localStorage', shared);
  shared.setItem('touliao_electron_token', 'normal');
  const enter = (session, id) => {
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('window', { location: { href: `https://fixture.invalid/login?accountWindow=${id}` } });
    initAccountWindow();
  };
  enter(a, idA);
  expect(isBearerClient()).toBe(true);
  expect(clientStorage.getItem('touliao_electron_token')).toBeNull();
  clientStorage.setItem('touliao_electron_token', 'A');
  enter(b, idB);
  expect(clientStorage.getItem('touliao_electron_token')).toBeNull();
  clientStorage.setItem('touliao_electron_token', 'B');
  enter(a, idA);
  expect(clientStorage.getItem('touliao_electron_token')).toBe('A');
  clientStorage.removeItem('touliao_electron_token');
  expect(shared.getItem('touliao_electron_token')).toBe('normal');
  expect(b.getItem('touliao_electron_token')).toBe('B');
  expect(accountWindowId()).toBe(idA);
});

test('copied sessionStorage credentials are cleared when opening a new account window', () => {
  const session = storage();
  session.setItem('touliao_account_window', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  session.setItem('touliao_electron_token', 'copied');
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('window', { location: { href: 'https://fixture.invalid/login?accountWindow=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' } });
  initAccountWindow();
  expect(session.getItem('touliao_electron_token')).toBeNull();
});
