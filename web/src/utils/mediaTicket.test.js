import { beforeEach, afterEach, expect, test, vi } from 'vitest';

function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)),
    removeItem: k => values.delete(k), key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
}
let mediaUrl, minted, duringSend;
const file = '/uploads/files/q02.txt';
const root = 'https://media.example';
beforeEach(async () => {
  vi.resetModules();
  const target = new EventTarget();
  target.__ELECTRON_CONFIG__ = {};
  vi.stubGlobal('window', target);
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  localStorage.setItem('touliao_server_url', root);
  localStorage.setItem('touliao_electron_token', 'credential-A');
  minted = 0;
  duringSend = undefined;
  // Network boundary only: real mediaUrl manages identity, caching and response handling.
  vi.stubGlobal('XMLHttpRequest', class {
    open() {}
    setRequestHeader() {}
    send() {
      minted++;
      const exp = Math.floor(Date.now() / 1000) + 30;
      this.status = 200;
      this.responseText = JSON.stringify({ url: `${file}?token=h.${btoa(JSON.stringify({ exp, serial: minted }))}.s` });
      duringSend?.();
    }
  });
  ({ mediaUrl } = await import('./url'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('same credential reuses ticket but refresh/account switch requests a fresh one', () => {
  const first = mediaUrl(file);
  expect(mediaUrl(file)).toBe(first);
  expect(minted).toBe(1);
  localStorage.setItem('touliao_electron_token', 'credential-B');
  expect(mediaUrl(file)).not.toBe(first);
  expect(minted).toBe(2);
});

test('legacy sessionStorage ticket is ignored when a legal credential regenerates access', () => {
  sessionStorage.setItem(`touliao_media_ticket:${file}`, JSON.stringify({ url: `${file}?token=legacy`, expiresAt: Date.now() + 500000 }));
  expect(mediaUrl(file)).not.toContain('legacy');
  expect(minted).toBe(1);
});

test('server switch cannot reuse another server ticket', () => {
  const first = mediaUrl(file);
  localStorage.setItem('touliao_server_url', 'https://other.example');
  expect(mediaUrl(file).replace('https://other.example', root)).not.toBe(first);
  expect(minted).toBe(2);
});

test('credential update event invalidates cache even when bearer text remains unchanged', () => {
  const first = mediaUrl(file);
  window.dispatchEvent(new Event('touliao:credentials-updated'));
  expect(mediaUrl(file)).not.toBe(first);
});

test('late ticket response cannot populate or return authority after a credential switch', () => {
  duringSend = () => localStorage.setItem('touliao_electron_token', 'credential-B');
  expect(mediaUrl(file)).toBe(root + file);
  duringSend = undefined;
  expect(mediaUrl(file)).toContain('?token=');
  expect(minted).toBe(2);
});

test('logout clears prior cache before a later login', () => {
  const first = mediaUrl(file);
  localStorage.removeItem('touliao_electron_token');
  expect(mediaUrl(file)).toBe(root + file);
  localStorage.setItem('touliao_electron_token', 'credential-A');
  expect(mediaUrl(file)).not.toBe(first);
});

test('cache never outlives a short-lived ticket', () => {
  vi.useFakeTimers();
  const first = mediaUrl(file);
  vi.advanceTimersByTime(31000);
  expect(mediaUrl(file)).not.toBe(first);
  expect(minted).toBe(2);
});
