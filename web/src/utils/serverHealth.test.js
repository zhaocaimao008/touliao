import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
let testServerConnection;
beforeAll(async () => {
  vi.stubGlobal('window', {});
  ({ testServerConnection } = await import('./config'));
});
afterEach(() => vi.unstubAllGlobals());
describe('server health contract', () => {
  it.each([400, 401, 404, 503])('rejects HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    expect(await testServerConnection('http://localhost:3001')).toMatchObject({ ok: false, reason: 'http', status });
  });
  it.each(['<html>proxy</html>', '{}', '{"ok":true}', '{"ok":false,"service":"touliao-backend"}'])('rejects unhealthy/non-backend response %s', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    expect((await testServerConnection('https://example.test')).ok).toBe(false);
  });
  it('accepts the real backend health response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, service: 'touliao-backend', db: 'ok', version: 2 })));
    vi.stubGlobal('fetch', fetch);
    expect((await testServerConnection('https://example.test/')).ok).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe('https://example.test/health');
  });
  it('rejects connection failures and timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
    expect((await testServerConnection('https://example.test')).ok).toBe(false);
  });
  it.each(['httpbad', 'file:///tmp/test', '', 'https://u:p@example.test'])('rejects invalid address %s without fetching', async url => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await testServerConnection(url)).toMatchObject({ ok: false, reason: 'format' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
