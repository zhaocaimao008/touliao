// 统一 DownloadManager —— 聊天附件(图片原图/视频/音频/文档/其他文件)保存到本地的
// 唯一入口。所有组件都通过这里发起下载，不再各自 fetch/下载一遍。
//
// 状态机：pending → downloading → completed | failed | cancelled。
// Electron 由主进程流式落盘并报告实际结果；Web 优先使用 File System Access，
// 不支持时退回 Blob / 原生链接下载。重试重新申请媒体票据并从头下载。
import { resolveMediaUrl } from './url';
import { showToast } from './toast';

const SOFT_MEMORY_LIMIT = 150 * 1024 * 1024; // 150MB：超过且无File System Access API时退化
const MAX_CONCURRENT = 3;

const tasks = new Map();   // id -> task state
const listeners = new Map(); // id -> Set<callback>
const queue = [];          // 排队等待的 id（超过并发上限时）
let activeCount = 0;

function emit(id) {
  const t = tasks.get(id);
  if (!t) return;
  (listeners.get(id) || []).forEach(cb => { try { cb({ ...t }); } catch { /* 忽略订阅方异常 */ } });
}

function setState(id, patch) {
  const t = tasks.get(id);
  if (!t) return;
  Object.assign(t, patch);
  emit(id);
}

export function subscribe(id, cb) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(cb);
  const t = tasks.get(id);
  if (t) cb({ ...t });
  return () => listeners.get(id)?.delete(cb);
}

export function getState(id) {
  const t = tasks.get(id);
  return t ? { ...t } : null;
}

function filenameFromUrl(u, fallbackExt = '') {
  try {
    const p = String(u).split('?')[0].split('#')[0];
    const base = p.substring(p.lastIndexOf('/') + 1);
    return decodeURIComponent(base) || `file_${Date.now()}${fallbackExt}`;
  } catch { return `file_${Date.now()}${fallbackExt}`; }
}

function isElectron() { return !!window.__ELECTRON_CONFIG__; }
function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function anchorDownload(href, name) {
  const a = document.createElement('a');
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

function checkCancelled(signal) {
  if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
}

function failAttempt(id, error, signal) {
  const cancelled = signal.aborted || error?.name === 'AbortError';
  setState(id, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? null : error?.message || '下载失败' });
}

function responseSize(response) {
  const size = Number(response.headers.get('Content-Length'));
  return Number.isFinite(size) && size > 0 ? size : 0;
}

async function checkResponse(response, signal) {
  if (response.ok && !signal.aborted) return;
  try { await response.body?.cancel(); } catch { /* Already aborted. */ }
  checkCancelled(signal);
  throw new Error('HTTP ' + response.status);
}

function reportBytes(id, received, total) {
  setState(id, { downloadedBytes: received, totalBytes: total, indeterminate: !total,
    progress: total ? Math.min(99, Math.round(received / total * 100)) : undefined });
}

async function releaseReader(reader, finished) {
  if (!reader) return;
  if (!finished) { try { await reader.cancel(); } catch { /* Already closed or aborted. */ } }
  reader.releaseLock();
}

function handToBrowser(id, url, name, signal) {
  checkCancelled(signal);
  anchorDownload(url, name);
  // The browser does not expose whether the user actually saved the file.
  setState(id, { status: 'completed', progress: 100, browserManaged: true });
}

async function runNext() {
  if (activeCount >= MAX_CONCURRENT || queue.length === 0) return;
  const id = queue.shift();
  const t = tasks.get(id);
  if (!t || t.status === 'cancelled') { runNext(); return; }
  activeCount++;
  try {
    await execute(id);
  } finally {
    activeCount--;
    runNext();
  }
}

async function execute(id) {
  const t = tasks.get(id);
  if (!t) return;
  const signal = t.abortController.signal;
  setState(id, { status: 'downloading', progress: 0, downloadedBytes: 0, totalBytes: 0, indeterminate: false, browserManaged: false });

  let url;
  try {
    url = t.url = await resolveMediaUrl(t.fileUrl);
    checkCancelled(signal);
  } catch (e) {
    failAttempt(id, e, signal);
    return;
  }
  const name = t.filename;

  // 每次尝试使用独立 ID，避免迟到的进度污染重试任务。
  const api = window.electronAPI;
  if (isElectron() && api?.downloadFile) {
    t.nativeId = crypto.randomUUID();
    let unsubscribe;
    try {
      unsubscribe = api.onDownloadProgress?.((state) => {
        if (state.id !== t.nativeId || state.status !== 'downloading') return;
        setState(id, { progress: state.progress, downloadedBytes: state.downloadedBytes || 0,
          totalBytes: state.totalBytes || 0 });
      });
      const result = await api.downloadFile(url, name, !!t.autoOpen, t.nativeId);
      if (!result || !['completed', 'failed', 'cancelled'].includes(result.status)) {
        throw new Error('桌面下载组件未返回保存结果，请更新客户端');
      }
      setState(id, { status: result.status, error: result.error || null,
        ...(result.status === 'completed' ? { progress: 100, savePath: result.savePath,
          downloadedBytes: result.downloadedBytes, totalBytes: result.totalBytes } : {}) });
    } catch (e) {
      setState(id, { status: 'failed', error: e?.message || '下载失败' });
    } finally {
      unsubscribe?.();
      t.nativeId = null;
    }
    return;
  }

  // 原生 App 兜底（当前未随出货客户端启用，出货Android/iOS走各自原生DownloadManager/PHPhotoLibrary）
  if (isNativeApp()) {
    try {
      const resp = await fetch(url, { credentials: 'include', signal });
      await checkResponse(resp, signal);
      const blob = await resp.blob();
      checkCancelled(signal);
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsDataURL(blob);
      });
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      checkCancelled(signal);
      await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Documents, recursive: true });
      setState(id, { status: 'completed', progress: 100 });
    } catch (e) {
      failAttempt(id, e, signal);
    }
    return;
  }

  // Web：优先 File System Access API 流式直写磁盘（真实进度、任意大小不占内存）
  if (typeof window.showSaveFilePicker === 'function') {
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: name });
      checkCancelled(signal);
    } catch (e) {
      // Fall back only if the picker API cannot be used in this context.
      // Dismissal, denied destinations and disk errors must not start another download.
      if (signal.aborted || !['SecurityError', 'NotSupportedError'].includes(e?.name)) {
        failAttempt(id, e, signal);
        return;
      }
    }
    if (handle) {
      try { await streamToDisk(id, url, handle, signal); }
      catch (e) { failAttempt(id, e, signal); }
      return;
    }
  }

  // 兜底：fetch 累积 + 边读边报进度；超过内存软上限则退化为原生 <a download> 直接导航
  let reader, finished = false;
  try {
    checkCancelled(signal);
    const resp = await fetch(url, { credentials: 'include', signal });
    await checkResponse(resp, signal);
    const total = responseSize(resp);
    reportBytes(id, 0, total);
    if (total > SOFT_MEMORY_LIMIT || !resp.body) {
      // 大文件且没有磁盘直写能力：交回浏览器自己流式下载，不经过JS内存，只是没有进度条
      try { await resp.body?.cancel(); } catch { /* Request already aborted. */ }
      handToBrowser(id, url, name, signal);
      return;
    }
    reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      checkCancelled(signal);
      const { done, value } = await reader.read();
      checkCancelled(signal);
      if (done) { finished = true; break; }
      received += value.byteLength;
      // Content-Length may be missing or inaccurate. Bound actual buffered data too.
      if (received > SOFT_MEMORY_LIMIT) {
        chunks.length = 0;
        await releaseReader(reader, false); reader = null;
        handToBrowser(id, url, name, signal);
        return;
      }
      chunks.push(value);
      reportBytes(id, received, total);
    }
    checkCancelled(signal);
    const blob = new Blob(chunks);
    const obj = URL.createObjectURL(blob);
    try { handToBrowser(id, obj, name, signal); }
    finally { setTimeout(() => URL.revokeObjectURL(obj), 15000); }
  } catch (e) {
    failAttempt(id, e, signal);
  } finally {
    await releaseReader(reader, finished);
  }
}

async function streamToDisk(id, url, handle, signal) {
  let writable, reader, finished = false;
  try {
    checkCancelled(signal);
    writable = await handle.createWritable();
    checkCancelled(signal);
    const resp = await fetch(url, { credentials: 'include', signal });
    await checkResponse(resp, signal);
    const total = responseSize(resp);
    reportBytes(id, 0, total);
    if (!resp.body) throw new Error('浏览器不支持流式响应');
    reader = resp.body.getReader();
    let received = 0;
    for (;;) {
      checkCancelled(signal);
      const { done, value } = await reader.read();
      checkCancelled(signal);
      if (done) { finished = true; break; }
      await writable.write(value);
      checkCancelled(signal);
      received += value.byteLength;
      reportBytes(id, received, total);
    }
    checkCancelled(signal);
    await writable.close();
    setState(id, { status: 'completed', progress: 100 });
  } catch (e) {
    try { await writable?.abort(); } catch { /* 忽略 */ }
    throw e;
  } finally {
    await releaseReader(reader, finished);
  }
}

/**
 * 发起一个下载任务（若已存在同 id 的未结束任务则直接复用，避免重复点击产生并发重复下载）。
 * @returns {string} taskId
 */
export function startDownload({ id, fileUrl, filename, mimeType, autoOpen = false }) {
  const taskId = id || fileUrl;
  const existing = tasks.get(taskId);
  if (existing && ['pending', 'downloading'].includes(existing.status)) return taskId;

  const resolvedUrl = fileUrl;
  const resolvedName = filename || filenameFromUrl(resolvedUrl);
  tasks.set(taskId, {
    id: taskId, fileUrl, url: resolvedUrl, filename: resolvedName, mimeType: mimeType || '', autoOpen: !!autoOpen,
    status: 'pending', progress: 0, downloadedBytes: 0, totalBytes: 0, indeterminate: false, browserManaged: false,
    error: null, abortController: new AbortController(),
  });
  emit(taskId);
  queue.push(taskId);
  runNext();
  return taskId;
}

export function cancelDownload(id) {
  const t = tasks.get(id);
  if (!t) return;
  if (t.status === 'pending') {
    const idx = queue.indexOf(id);
    if (idx >= 0) queue.splice(idx, 1);
    setState(id, { status: 'cancelled' });
    return;
  }
  if (t.status === 'downloading') {
    t.abortController.abort();
    if (t.nativeId) {
      window.electronAPI?.cancelDownload?.(t.nativeId).catch(() => {
        showToast('取消下载失败，请重试', 'error');
      });
    }
    // 等主进程清理文件后返回 cancelled，期间仍占用并发槽位。
  }
}

export function retryDownload(id) {
  const t = tasks.get(id);
  if (!t || !['failed', 'cancelled'].includes(t.status)) return;
  t.abortController = new AbortController();
  setState(id, { status: 'pending', progress: 0, downloadedBytes: 0, totalBytes: 0, indeterminate: false, browserManaged: false, savePath: null, error: null });
  queue.push(id);
  runNext();
}

/** 兼容旧调用：不需要进度 UI 的场景，直接触发一次性下载（内部走同一套 DownloadManager）。 */
export async function downloadFile(fileUrl, filename) {
  const isPlainWeb = !isElectron() && !isNativeApp();
  // 纯网页且用户浏览器没有 File System Access API 时，最简单可靠的路径就是原生
  // <a download> 直接导航——保留这条快速路径，避免所有旧调用点都被迫感知进度状态。
  if (isPlainWeb && typeof window.showSaveFilePicker !== 'function') {
    try { anchorDownload(await resolveMediaUrl(fileUrl), filename || filenameFromUrl(fileUrl)); }
    catch (e) { showToast('下载失败：' + e.message, 'error'); }
    return;
  }
  const id = startDownload({ fileUrl, filename });
  const unsubscribe = subscribe(id, (s) => {
    if (s.status === 'failed') showToast('下载失败：' + (s.error || '网络错误'), 'error');
    if (['completed', 'failed', 'cancelled'].includes(s.status)) queueMicrotask(() => unsubscribe());
  });
}
