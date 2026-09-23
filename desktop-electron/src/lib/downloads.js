'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function safeFilename(raw) {
  let name = String(raw || 'download').replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, '_').trim().replace(/[. ]+$/, '');
  if (!name) name = 'download';
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name;
  const ext = path.extname(name).slice(0, 20);
  let base = name.slice(0, name.length - path.extname(name).length);
  // Also fit UTF-8 filesystems when a long Chinese filename is downloaded on Linux/macOS.
  while (base.length + ext.length > 120 || Buffer.byteLength(base + ext) > 240) base = Array.from(base).slice(0, -1).join('');
  return base + ext;
}

// Exclusive creation reserves the name even when another transfer has not received bytes yet.
function openDestination(directory, filename) {
  fs.mkdirSync(directory, { recursive: true });
  const ext = path.extname(filename), base = filename.slice(0, filename.length - ext.length);
  for (let i = 0; i < 1000; i++) {
    const destination = path.join(directory, i ? `${base} (${i})${ext}` : filename);
    try { return { path: destination, fd: fs.openSync(destination, 'wx', 0o600) }; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('Too many files with the same name');
}

function createDownloadService({ getDirectory, allowedOrigins, shell, noAutoOpenExts, idleTimeoutMs = 90000 }) {
  const active = new Map();
  const keyFor = (sender, id) => `${sender.id}:${id}`;
  return {
    cancel(sender, id) {
      const task = active.get(keyFor(sender, id));
      if (!task) return false;
      task.cancelled = true;
      task.controller.abort();
      return true;
    },
    async download(sender, payload = {}) {
      const id = payload.id || randomUUID();
      const failure = error => ({ id, status: 'failed', error });
      if (typeof id !== 'string' || id.length > 200) return failure('Invalid download ID');
      let url;
      try { url = new URL(payload.url); } catch { return failure('Invalid download URL'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !allowedOrigins().includes(url.origin)) {
        return failure('Download source is not allowed');
      }
      const key = keyFor(sender, id);
      if (active.has(key)) return failure('Download is already running');
      const task = { controller: new AbortController(), cancelled: false };
      active.set(key, task);
      let destination, timer, timedOut = false;
      let received = 0, total = 0, lastUpdate = 0;
      const signal = task.controller.signal;
      const notify = state => {
        if (!sender.isDestroyed()) sender.send('file:download-progress', { id, ...state });
      };
      const resetTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { timedOut = true; task.controller.abort(); }, idleTimeoutMs);
        timer.unref?.();
      };
      const cancelOnClose = () => { task.cancelled = true; task.controller.abort(); };
      sender.once('destroyed', cancelOnClose);
      sender.once('render-process-gone', cancelOnClose);
      try {
        resetTimer();
        notify({ status: 'downloading', progress: 0 });
        // The owning Chromium session retains proxy/cookie/redirect support. The response is
        // streamed with backpressure; even multi-GB videos never become an in-memory Blob.
        const response = await sender.session.fetch(url.href, { signal, credentials: 'include' });
        if (!response.ok || response.status === 204 || response.status === 206) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        if (!response.body) throw new Error('Empty download response');
        signal.throwIfAborted();
        let fallback;
        try { fallback = decodeURIComponent(url.pathname.split('/').pop()); } catch { fallback = 'download'; }
        destination = openDestination(getDirectory(), safeFilename(payload.filename || fallback));
        // Compressed responses are decoded by fetch, so their Content-Length is not a byte total.
        total = response.headers.get('content-encoding') ? 0 : Number(response.headers.get('content-length')) || 0;
        const counter = new Transform({ transform(chunk, _encoding, callback) {
          received += chunk.length;
          resetTimer();
          if (Date.now() - lastUpdate >= 100) {
            lastUpdate = Date.now();
            notify({ status: 'downloading', downloadedBytes: received, totalBytes: total,
              progress: total ? Math.min(99, Math.floor(received / total * 100)) : null });
          }
          callback(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), counter,
          fs.createWriteStream(destination.path, { fd: destination.fd }), { signal });
        signal.throwIfAborted();
        if (total && received !== total) throw new Error('Incomplete download');
        clearTimeout(timer);
        const result = { id, status: 'completed', progress: 100, downloadedBytes: received,
          totalBytes: total || received, savePath: destination.path };
        notify(result);
        if (payload.autoOpen === true) {
          // Never execute a downloaded script/installer automatically.
          try {
            if (noAutoOpenExts.has(path.extname(destination.path).toLowerCase())) shell.showItemInFolder(destination.path);
            else await shell.openPath(destination.path);
          } catch { /* The file was saved even if the external application cannot open it. */ }
        }
        return result;
      } catch (error) {
        task.controller.abort();
        let cleanupError = '';
        if (destination) {
          try { fs.unlinkSync(destination.path); }
          catch (e) { if (e.code !== 'ENOENT') cleanupError = `; partial file: ${destination.path}`; }
        }
        const result = { id, status: task.cancelled ? 'cancelled' : 'failed',
          error: task.cancelled && !cleanupError ? null : (timedOut ? 'Download timed out' : error.message) + cleanupError };
        notify(result);
        return result;
      } finally {
        clearTimeout(timer);
        active.delete(key);
        sender.removeListener('destroyed', cancelOnClose);
        sender.removeListener('render-process-gone', cancelOnClose);
      }
    },
  };
}

function registerDownloadIPC({ ipcMain, isTrustedSender, ...options }) {
  const downloads = createDownloadService(options);
  ipcMain.handle('file:download', (event, payload) => {
    if (!isTrustedSender(event)) return { status: 'failed', error: 'Untrusted download sender' };
    return downloads.download(event.sender, payload);
  });
  ipcMain.handle('file:cancelDownload', (event, id) => isTrustedSender(event) && downloads.cancel(event.sender, id));
  return downloads;
}

module.exports = { createDownloadService, registerDownloadIPC, safeFilename };
