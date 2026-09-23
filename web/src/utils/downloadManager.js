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
  setState(id, { status: 'downloading', progress: 0, downloadedBytes: 0 });

  let url;
  try {
    url = t.url = await resolveMediaUrl(t.fileUrl);
    if (t.abortController.signal.aborted) { setState(id, { status: 'cancelled' }); return; }
  } catch (e) {
    setState(id, { status: t.abortController.signal.aborted ? 'cancelled' : 'failed', error: e.message });
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
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsDataURL(blob);
      });
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Documents, recursive: true });
      setState(id, { status: 'completed', progress: 100 });
    } catch (e) {
      setState(id, { status: 'failed', error: e?.message || '下载失败' });
    }
    return;
  }

  // Web：优先 File System Access API 流式直写磁盘（真实进度、任意大小不占内存）
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      await streamToDisk(id, url, name);
      return;
    } catch (e) {
      if (e?.name === 'AbortError') { setState(id, { status: 'cancelled' }); return; }
      // 用户拒绝了保存对话框，或该次调用失败：退回到下面的兜底路径，不直接判失败
      console.warn('[download] File System Access 保存失败，退回兜底方案:', e?.message);
    }
  }

  // 兜底：fetch 累积 + 边读边报进度；超过内存软上限则退化为原生 <a download> 直接导航
  try {
    const resp = await fetch(url, { credentials: 'include', signal: t.abortController.signal });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const total = Number(resp.headers.get('Content-Length')) || 0;
    if (total > SOFT_MEMORY_LIMIT || !resp.body) {
      // 大文件且没有磁盘直写能力：交回浏览器自己流式下载，不经过JS内存，只是没有进度条
      anchorDownload(url, name);
      setState(id, { status: 'completed', progress: 100, indeterminate: true });
      return;
    }
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      setState(id, {
        downloadedBytes: received,
        progress: total ? Math.round((received / total) * 100) : undefined,
      });
    }
    const blob = new Blob(chunks);
    const obj = URL.createObjectURL(blob);
    anchorDownload(obj, name);
    setTimeout(() => URL.revokeObjectURL(obj), 15000);
    setState(id, { status: 'completed', progress: 100 });
  } catch (e) {
    if (e?.name === 'AbortError') { setState(id, { status: 'cancelled' }); return; }
    setState(id, { status: 'failed', error: e?.message || '网络错误' });
  }
}

async function streamToDisk(id, url, name) {
  const t = tasks.get(id);
  const handle = await window.showSaveFilePicker({ suggestedName: name });
  const writable = await handle.createWritable();
  try {
    const resp = await fetch(url, { credentials: 'include', signal: t.abortController.signal });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const total = Number(resp.headers.get('Content-Length')) || 0;
    if (!resp.body) throw new Error('浏览器不支持流式响应');
    const reader = resp.body.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      received += value.length;
      setState(id, {
        downloadedBytes: received,
        progress: total ? Math.round((received / total) * 100) : undefined,
      });
    }
    await writable.close();
    setState(id, { status: 'completed', progress: 100 });
  } catch (e) {
    try { await writable.abort(); } catch { /* 忽略 */ }
    throw e;
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
    status: 'pending', progress: 0, downloadedBytes: 0, totalBytes: 0,
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
  setState(id, { status: 'pending', progress: 0, downloadedBytes: 0, totalBytes: 0, savePath: null, error: null });
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
