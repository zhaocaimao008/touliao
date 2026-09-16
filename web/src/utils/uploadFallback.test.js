import { afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { setupAxiosInterceptors } from './axiosInterceptor';
afterEach(() => vi.unstubAllGlobals());
test('an explicitly unavailable cloud backend falls back immediately, without three retries', async () => {
  const storage = new Map();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) });
  vi.stubGlobal('document', { cookie: '' });
  const adapter = vi.fn(async config => {
    throw new axios.AxiosError('Cloud not configured', 'ERR_BAD_RESPONSE', config, null,
      { status: 503, data: { error_code: 'CLOUD_STORAGE_UNCONFIGURED' }, config });
  });
  const client = axios.create({ adapter });
  setupAxiosInterceptors(client);
  await expect(client.post('/api/upload/credential', {})).rejects.toMatchObject({ response: { status: 503 } });
  expect(adapter).toHaveBeenCalledOnce();
});
