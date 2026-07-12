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
