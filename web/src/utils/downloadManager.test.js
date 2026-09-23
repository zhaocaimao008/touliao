import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./url', () => ({ resolveMediaUrl: vi.fn(url => url + '?ticket=fresh') }));
vi.mock('./toast', () => ({ showToast: vi.fn() }));
let manager, api, progress, pending;
beforeEach(async () => {
  vi.resetModules(); pending = [];
  api = {
    downloadFile: vi.fn((...args) => new Promise((resolve, reject) => pending.push({ args, resolve, reject }))),
    cancelDownload: vi.fn(async () => true),
    onDownloadProgress: vi.fn(cb => { progress = cb; return vi.fn(); }),
  };
  vi.stubGlobal('window', { __ELECTRON_CONFIG__: {}, electronAPI: api });
  manager = await import('./downloadManager');
});
afterEach(() => vi.unstubAllGlobals());
const tick = () => new Promise(r => setTimeout(r, 0));
const start = (id = 'video') => manager.startDownload({ id, fileUrl: '/uploads/video.mp4', filename: id + '.mp4' });
it('awaits real completion and publishes byte progress and save path', async () => {
  start(); await tick(); expect(manager.getState('video').status).toBe('downloading');
  progress({ id: pending[0].args[3], status: 'downloading', progress: 30, downloadedBytes: 3, totalBytes: 10 });
  expect(manager.getState('video').progress).toBe(30);
  pending[0].resolve({ status: 'completed', savePath: 'C:\\Downloads\\video.mp4', downloadedBytes: 10, totalBytes: 10 }); await tick();
  expect(manager.getState('video')).toMatchObject({ status: 'completed', progress: 100, savePath: 'C:\\Downloads\\video.mp4' });
  expect(api.onDownloadProgress.mock.results[0].value).toHaveBeenCalledOnce();
});
it('HTTP failure remains failed and retry renews URL and task identity', async () => {
  const { resolveMediaUrl } = await import('./url'); start(); await tick();
  pending[0].resolve({ status: 'failed', error: 'HTTP 403' }); await tick();
  expect(manager.getState('video')).toMatchObject({ status: 'failed', error: 'HTTP 403' });
  resolveMediaUrl.mockReturnValueOnce('/uploads/video.mp4?ticket=renewed');
  manager.retryDownload('video'); await tick(); expect(pending[1].args[0]).toContain('ticket=renewed');
  expect(pending[1].args[3]).not.toBe(pending[0].args[3]);
  pending[1].resolve({ status: 'completed' }); await tick();
});
it('cancellation reaches main process and waits for cleanup', async () => {
  start(); await tick(); manager.cancelDownload('video');
  expect(api.cancelDownload).toHaveBeenCalledWith(pending[0].args[3]);
  expect(manager.getState('video').status).toBe('downloading');
  pending[0].resolve({ status: 'cancelled' }); await tick();
  expect(manager.getState('video').status).toBe('cancelled');
});
it('IPC rejection and an old preload missing completion never claim success', async () => {
  start(); await tick(); pending[0].reject(Error('IPC disconnected')); await tick();
  expect(manager.getState('video').status).toBe('failed');
  manager.retryDownload('video'); await tick(); pending[1].resolve(undefined); await tick();
  expect(manager.getState('video').status).toBe('failed');
});
it('limits concurrency until files finish and can cancel queued work', async () => {
  for (const id of ['a', 'b', 'c', 'd']) start(id);
  await tick();
  expect(pending).toHaveLength(3); expect(manager.getState('d').status).toBe('pending');
  manager.cancelDownload('d'); expect(manager.getState('d').status).toBe('cancelled');
  pending.forEach(p => p.resolve({ status: 'completed' })); await tick(); expect(pending).toHaveLength(3);
});
it('duplicate clicks and retry of active tasks never start a second request', async () => {
  start(); await tick(); start(); await tick(); manager.retryDownload('video'); await tick(); expect(pending).toHaveLength(1);
  pending[0].resolve({ status: 'completed' }); await tick();
});
it('progress from another attempt does not change this task', async () => {
  start(); await tick(); progress({ id: 'obsolete-id', status: 'downloading', progress: 99 });
  expect(manager.getState('video').progress).toBe(0);
  pending[0].resolve({ status: 'failed' }); await tick();
});
