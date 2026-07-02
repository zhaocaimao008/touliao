// 统一「下载并可打开文件」逻辑，避免点文件跳出浏览器网页：
//   纯网页(同源)：<a download> 流式下载——边下边落盘、不占内存、支持大文件(1GB)，同源 download 必生效。
//   Windows 桌面(Electron)：交主进程 downloadURL（渲染进程跨域 fetch 会被 CORS 拦、<a download> 跨域失效），
//     由 will-download 落盘到「下载」目录、下完自动用系统应用打开。
//   原生 App(Capacitor，当前未随出货客户端启用)：@capacitor/filesystem 存到「文档」目录后可在系统「文件」打开。
// 注：出货安卓是原生 Kotlin App，其文件下载在 Kotlin 侧用 DownloadManager 实现，不走本文件。
import { mediaUrl } from './url';
import { showToast } from './toast';
import { Filesystem, Directory } from '@capacitor/filesystem';

function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('读取文件失败'));
    r.readAsDataURL(blob);
  });
}

function anchorDownload(href, name) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadFile(fileUrl, filename) {
  const name = (filename && String(filename).trim()) || `file_${Date.now()}`;
  const url = mediaUrl(fileUrl);
  const isElectron = !!window.__ELECTRON_CONFIG__;

  // 纯网页（同源）：直接用 <a download> 流式下载——浏览器边下边落盘、不把整文件读进内存，
  // 支持大文件（上限 1GB），且 download 属性同源必生效、不会导航到网页。
  if (!isElectron && !isNative()) {
    anchorDownload(url, name);
    return;
  }

  // Electron：交主进程 downloadURL 流式落盘到「下载」并自动打开（渲染进程跨域 fetch 会被 CORS 拦）。
  const electronDownload = window.electronAPI?.downloadFile || window.vxinAPI?.downloadFile;
  if (isElectron && electronDownload) {
    electronDownload(url, name);
    return;
  }

  // 原生 App / 旧版 Electron 兜底：取回内容再保存（大文件占内存，仅兜底）。
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();

    if (isNative()) {
      // 原生 App：存到 Documents，提示可在系统「文件」中打开
      showToast('正在保存…');
      const base64 = await blobToBase64(blob);
      await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Documents, recursive: true });
      showToast(`已保存：${name}（可在系统「文件」中打开）`, 'success');
    } else {
      // Electron：blob: 同源 → download 属性生效，直接下载不导航
      const obj = URL.createObjectURL(blob);
      anchorDownload(obj, name);
      setTimeout(() => URL.revokeObjectURL(obj), 15000);
    }
  } catch (e) {
    showToast('下载失败：' + (e?.message || '网络错误'), 'error');
  }
}
