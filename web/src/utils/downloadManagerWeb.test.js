import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('./url', () => ({ resolveMediaUrl: vi.fn(url => url + '?ticket=fresh') }));
vi.mock('./toast', () => ({ showToast: vi.fn() }));
let manager, anchor, createObjectURL;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const start = () => manager.startDownload({ id: 'file', fileUrl: '/uploads/file.bin', filename: 'file.bin' });
const state = () => manager.getState('file');
function response(total = null) {
  let controller;
  const cancel = vi.fn();
  const body = new ReadableStream({ start(value) { controller = value; }, cancel });
  return { ok: true, headers: new Headers(total == null ? {} : { 'Content-Length': String(total) }), body, controller, cancel };
}
beforeEach(async () => {
  vi.resetModules();
  anchor = { click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn() } });
  vi.stubGlobal('fetch', vi.fn());
  createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  manager = await import('./downloadManager');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('shows indeterminate progress when file size is unknown and distinguishes browser handoff from a saved file', async () => {
  const res = response(); fetch.mockResolvedValue(res);
  start(); await tick(); res.controller.enqueue(new Uint8Array([1, 2, 3])); await tick();
  expect(state()).toMatchObject({ status: 'downloading', downloadedBytes: 3, totalBytes: 0, indeterminate: true });
  expect(state().progress).toBeUndefined();
  res.controller.close(); await tick();
  expect(state()).toMatchObject({ status: 'completed', browserManaged: true });
  expect(anchor.click).toHaveBeenCalledOnce(); expect(res.body.locked).toBe(false);
});

it('reports the advertised size and never claims 100 percent before the transfer finishes', async () => {
  const res = response(2); fetch.mockResolvedValue(res);
  start(); await tick(); res.controller.enqueue(new Uint8Array(6)); await tick();
  const progressState = state(); res.controller.close(); await tick();
  expect(progressState).toMatchObject({ totalBytes: 2, downloadedBytes: 6, indeterminate: false, progress: 99 });
});

it.each([null, 1024])('bounds actual buffered bytes with Content-Length %s and releases the fetch before browser handoff', async total => {
  const res = response(total); fetch.mockResolvedValue(res);
  const chunk = new Uint8Array(80 * 1024 * 1024);
  start(); await tick(); res.controller.enqueue(chunk); await tick(); res.controller.enqueue(chunk); await tick();
  const snapshot = state();
  // Also finish an unfixed implementation so this regression leaves no pending stream.
  if (snapshot.status === 'downloading') { manager.cancelDownload('file'); res.controller.close(); await tick(); }
  expect(snapshot).toMatchObject({ status: 'completed', browserManaged: true });
  expect(res.cancel).toHaveBeenCalledOnce(); expect(res.body.locked).toBe(false);
  expect(createObjectURL).not.toHaveBeenCalled(); expect(anchor.href).toContain('ticket=fresh');
});

it('cancels an oversized response body before handing it to the browser', async () => {
  const res = response(200 * 1024 * 1024); fetch.mockResolvedValue(res);
  start(); await tick();
  expect(res.cancel).toHaveBeenCalledOnce(); expect(anchor.click).toHaveBeenCalledOnce();
  expect(state()).toMatchObject({ status: 'completed', browserManaged: true });
});

it('does not save a partial blob when a pending read ends after cancellation', async () => {
  const res = response(10); fetch.mockResolvedValue(res);
  start(); await tick(); res.controller.enqueue(new Uint8Array(3)); await tick();
  manager.cancelDownload('file'); res.controller.close(); await tick();
  expect(state().status).toBe('cancelled'); expect(anchor.click).not.toHaveBeenCalled();
  expect(res.body.locked).toBe(false);
});

it('does not create or truncate a destination if cancellation happened while choosing it', async () => {
  const picker = deferred(); const handle = { createWritable: vi.fn(async () => ({ abort: vi.fn() })) };
  window.showSaveFilePicker = vi.fn(() => picker.promise);
  start(); await tick(); manager.cancelDownload('file'); picker.resolve(handle); await tick();
  expect(handle.createWritable).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(state().status).toBe('cancelled');
});

it('a disk write failure is retryable and never silently triggers another download', async () => {
  const res = response(3); res.controller.enqueue(new Uint8Array(3));
  const writable = { write: vi.fn(async () => { throw Error('Disk full'); }), abort: vi.fn(async () => {}), close: vi.fn() };
  window.showSaveFilePicker = vi.fn(async () => ({ createWritable: async () => writable }));
  fetch.mockResolvedValueOnce(res).mockRejectedValue(new Error('Unexpected second fetch'));
  start(); await tick(); await tick();
  expect(state()).toMatchObject({ status: 'failed', error: 'Disk full' });
  expect(fetch).toHaveBeenCalledOnce(); expect(anchor.click).not.toHaveBeenCalled();
  expect(writable.abort).toHaveBeenCalledOnce(); expect(res.cancel).toHaveBeenCalledOnce();
  expect(res.body.locked).toBe(false);
});

it('a non-AbortError after cancellation still stays cancelled with no fallback', async () => {
  const writing = deferred(); const res = response(3); res.controller.enqueue(new Uint8Array(3));
  const writable = { write: vi.fn(() => writing.promise), abort: vi.fn(async () => {}), close: vi.fn() };
  window.showSaveFilePicker = vi.fn(async () => ({ createWritable: async () => writable }));
  fetch.mockResolvedValueOnce(res).mockRejectedValue(new Error('Unexpected second fetch'));
  start(); await tick(); manager.cancelDownload('file'); writing.reject(Error('Stream closed')); await tick();
  expect(state().status).toBe('cancelled'); expect(fetch).toHaveBeenCalledOnce();
  expect(anchor.click).not.toHaveBeenCalled(); expect(writable.close).not.toHaveBeenCalled();
});

it('falls back only when the file picker cannot be used in this browser context', async () => {
  const res = response(3); res.controller.enqueue(new Uint8Array(3)); res.controller.close();
  window.showSaveFilePicker = vi.fn(async () => { throw new DOMException('User activation required', 'SecurityError'); });
  fetch.mockResolvedValue(res);
  start(); await tick();
  expect(state()).toMatchObject({ status: 'completed', browserManaged: true }); expect(anchor.click).toHaveBeenCalledOnce();
});

it('does not fall back after the user dismisses the picker', async () => {
  window.showSaveFilePicker = vi.fn(async () => { throw new DOMException('Dismissed', 'AbortError'); });
  start(); await tick();
  expect(state().status).toBe('cancelled'); expect(fetch).not.toHaveBeenCalled(); expect(anchor.click).not.toHaveBeenCalled();
});

it('streams to disk with byte progress and closes before reporting saved', async () => {
  const res = response(4); const closing = deferred();
  const writable = { write: vi.fn(async () => {}), abort: vi.fn(), close: vi.fn(() => closing.promise) };
  window.showSaveFilePicker = vi.fn(async () => ({ createWritable: async () => writable })); fetch.mockResolvedValue(res);
  start(); await tick(); res.controller.enqueue(new Uint8Array(2)); await tick();
  const progressState = state(); res.controller.enqueue(new Uint8Array(2)); res.controller.close(); await tick();
  expect(state().status).toBe('downloading'); closing.resolve(); await tick();
  expect(progressState).toMatchObject({ downloadedBytes: 2, totalBytes: 4, progress: 50 });
  expect(state()).toMatchObject({ status: 'completed', browserManaged: false }); expect(res.body.locked).toBe(false);
});

it('HTTP errors release their response body and retry obtains a fresh media ticket', async () => {
  const { resolveMediaUrl } = await import('./url');
  const failed = response(); failed.ok = false; failed.status = 403;
  fetch.mockResolvedValueOnce(failed);
  start(); await tick();
  expect(state()).toMatchObject({ status: 'failed', error: 'HTTP 403' });
  expect(failed.cancel).toHaveBeenCalledOnce();
  const success = response(3); success.controller.enqueue(new Uint8Array(3)); success.controller.close();
  resolveMediaUrl.mockReturnValueOnce('/uploads/file.bin?ticket=renewed'); fetch.mockResolvedValueOnce(success);
  manager.retryDownload('file'); await tick();
  expect(fetch.mock.calls[1][0]).toContain('ticket=renewed');
  expect(state()).toMatchObject({ status: 'completed', browserManaged: true, error: null });
});

it('cancellation before response headers arrive releases the body without starting a browser save', async () => {
  const headers = deferred(); const res = response(); fetch.mockReturnValue(headers.promise);
  start(); await tick(); manager.cancelDownload('file'); headers.resolve(res); await tick();
  expect(state().status).toBe('cancelled'); expect(res.cancel).toHaveBeenCalledOnce();
  expect(anchor.click).not.toHaveBeenCalled();
});
