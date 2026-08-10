// 统一「分享到第三方软件」逻辑（图片/视频/文件/文档）。
//
// 优先级：
//   1. Web Share API Level 2（navigator.canShare({files}))：手机浏览器 / PWA / 支持的桌面浏览器
//      → 直接拉起系统分享面板（微信/QQ/邮件/AirDrop 等），把文件本体交出去。
//   2. 仅 URL 分享（navigator.share({url})）：不支持文件但支持链接分享的环境兜底。
//   3. 都不支持（多数桌面 Electron / 老浏览器）：回退到「下载」，并提示用户手动分享。
//
// 注：出货的安卓/iOS 是原生 App，其「分享到第三方」在原生侧用
//   Intent.ACTION_SEND / UIActivityViewController 实现，不走本文件。
import { mediaUrl } from './url';
import { showToast } from './toast';
import { downloadFile } from './download';

// 从（可能带 ?token= / #t= 的）地址里抽一个像样的文件名
function filenameFromUrl(u, fallbackExt = '') {
  try {
    const p = String(u).split('?')[0].split('#')[0];
    const base = p.substring(p.lastIndexOf('/') + 1);
    const name = decodeURIComponent(base);
    if (name) return name;
  } catch { /* ignore */ }
  return `share_${Date.now()}${fallbackExt}`;
}

// 能否用文件级分享（Web Share API Level 2）
export function canShareFiles() {
  try {
    return typeof navigator !== 'undefined'
      && typeof navigator.canShare === 'function'
      && typeof navigator.share === 'function';
  } catch { return false; }
}

// 能否用（哪怕只是链接的）分享
export function canShare() {
  try { return typeof navigator !== 'undefined' && typeof navigator.share === 'function'; }
  catch { return false; }
}

/**
 * 把一条消息的媒体分享到第三方软件。
 * @param {object} opts
 * @param {string} opts.fileUrl  资源相对/绝对地址
 * @param {string} [opts.filename] 展示/保存用文件名
 * @param {string} [opts.mime]  MIME 类型（拿不到会从扩展名/内容猜）
 * @param {string} [opts.text]  附带文案（文本消息可只传 text）
 * @param {string} [opts.title] 分享标题
 * @returns {Promise<boolean>} 是否成功走了分享（false 表示已回退到下载/复制）
 */
export async function shareMessage({ fileUrl, filename, mime, text, title } = {}) {
  const isElectron = !!window.__ELECTRON_CONFIG__;

  // 纯文本分享：无文件，直接分享文案
  if (!fileUrl && text) {
    if (canShare()) {
      try { await navigator.share({ text, title }); return true; }
      catch (e) { if (e?.name === 'AbortError') return false; }
    }
    // 兜底：复制到剪贴板
    try { await navigator.clipboard.writeText(text); showToast('已复制到剪贴板，可粘贴分享', 'success'); }
    catch { showToast('当前环境不支持分享', 'error'); }
    return false;
  }

  const url = mediaUrl(fileUrl);
  const name = (filename && String(filename).trim()) || filenameFromUrl(url);

  // Electron 桌面端 / 不支持文件分享：回退到下载后由用户手动分享
  if (isElectron || !canShareFiles()) {
    await downloadFile(fileUrl, name);
    showToast('已下载，可在系统里手动分享', 'info');
    return false;
  }

  // Web Share API Level 2：取回文件本体 → 交系统分享面板
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const type = mime || blob.type || 'application/octet-stream';
    const file = new File([blob], name, { type });

    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      // 该文件类型不被系统分享接受 → 退回链接分享/下载
      if (canShare()) {
        try { await navigator.share({ url, title: title || name }); return true; }
        catch (e) { if (e?.name === 'AbortError') return false; }
      }
      await downloadFile(fileUrl, name);
      showToast('该文件类型不支持直接分享，已下载', 'info');
      return false;
    }

    await navigator.share({ files: [file], title: title || name, text });
    return true;
  } catch (e) {
    if (e?.name === 'AbortError') return false; // 用户主动取消，不算失败
    // 分享失败兜底：下载
    await downloadFile(fileUrl, name);
    showToast('分享失败，已改为下载：' + (e?.message || '网络错误'), 'error');
    return false;
  }
}
