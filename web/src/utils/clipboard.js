// 复制文本到剪贴板，返回是否成功。
// 优先 navigator.clipboard（需安全上下文/HTTPS）；不可用时（桌面 file://、非 HTTPS）
// 回退到临时 textarea + execCommand('copy')，保证各端都有可靠复制。
export async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 落到兜底方案 */ }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    el.setAttribute('readonly', '');
    document.body.appendChild(el);
    el.focus();
    el.select();
    // iOS Safari 下 select() 对隐藏 textarea 不选中,须显式 setSelectionRange 才能 execCommand 复制成功
    if (typeof el.setSelectionRange === 'function') el.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

// 把 blob 转成 PNG（浏览器剪贴板对图片只可靠支持 image/png；jpg/webp 直接写多数会失败）。
// 已是 png 则原样返回。解码失败抛错，交由上层兜底提示。
async function toPngBlob(blob) {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas 编码失败'))), 'image/png');
    });
  } finally {
    bitmap.close?.();
  }
}

// 复制图片到剪贴板，返回是否成功。
//   - Electron：renderer 跑在 file://，图片是跨域 https(带 ?token=)，fetch/canvas 会撞 CORS/画布污染，
//     故走主进程原生 clipboard（electronAPI.copyImage），传绝对 URL（mediaUrl 已附 token）。
//   - Web：图片与页面同源(/uploads，Cookie 鉴权)，fetch 取 blob → 转 PNG → Clipboard API 写入。
//   - 移动端 WebView 不可靠支持图片剪贴板，返回 false 由上层提示（移动端另有"保存到相册"）。
export async function copyImageToClipboard(absUrl) {
  if (!absUrl) return false;

  // Electron 原生路径
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.copyImage) {
    try { return await api.copyImage(absUrl); } catch { return false; }
  }

  // Web 路径：需安全上下文 + Clipboard.write + ClipboardItem
  if (!(window.isSecureContext && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined')) {
    return false;
  }
  try {
    const resp = await fetch(absUrl, { credentials: 'include' });
    if (!resp.ok) return false;
    const raw = await resp.blob();
    const png = await toPngBlob(raw);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}
