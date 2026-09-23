import { iconFavicon } from '../ui-kit/canvasIcon';
/**
 * 来电视觉提醒：标题栏闪烁 + favicon 变化。
 * 纯视觉、零权限、零依赖——浏览器 autoplay 限制下无手势时唯一 100% 生效的提醒层。
 * 后台标签页同样可见（桌面浏览器）。
 */
let _titleTimer = null;
let _origTitle = '';
let _origFavicon = null;

function setFavicon(href) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
}


/**
 * 开始来电视觉提醒：标题在「xx 来电」与原标题间轮换，favicon 换为红色电话。
 * 幂等：已在提醒中则忽略。
 */
export function startCallVisualAlert(name) {
  if (_titleTimer) return;
  _origTitle = document.title;
  const orig = document.querySelector('link[rel="icon"]');
  _origFavicon = orig ? orig.href : null;
  setFavicon(iconFavicon('phone'));
  let showCall = true;
  _titleTimer = setInterval(() => {
    document.title = showCall ? `${name} 来电 - ${_origTitle}` : _origTitle;
    showCall = !showCall;
  }, 900);
}

/** 停止视觉提醒并恢复原标题/favicon（幂等）。 */
export function stopCallVisualAlert() {
  if (_titleTimer) { clearInterval(_titleTimer); _titleTimer = null; }
  document.title = _origTitle;
  if (_origFavicon !== null) setFavicon(_origFavicon);
  _origFavicon = null;
}
