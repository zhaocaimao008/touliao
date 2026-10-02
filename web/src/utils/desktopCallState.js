/**
 * 桌面端「通话中」状态同步（2026-10）。
 *
 * CallModal / GroupCallModal 在通话开始/结束时调用 setDesktopCallActive；这里按调用方 key
 * 汇总成一个布尔值，变化时：
 *  · 经 preload 的 electronAPI.setInCall 告知 Electron 主进程（关窗/托盘退出确认、
 *    通话中拒绝安装更新、powerSaveBlocker 防睡眠）；非 Electron 环境无操作；
 *  · 派发 window 事件 touliao:call-active（UpdateBanner 据此置灰「重启安装」）。
 */
const activeKeys = new Set();
let lastActive = false;

export const DESKTOP_CALL_EVENT = 'touliao:call-active';

export function isDesktopCallActive() {
  return activeKeys.size > 0;
}

export function setDesktopCallActive(key, active) {
  if (active) activeKeys.add(key);
  else activeKeys.delete(key);
  const now = activeKeys.size > 0;
  if (now === lastActive) return;
  lastActive = now;
  if (typeof window === 'undefined') return;
  try {
    const pending = window.electronAPI?.setInCall?.(now);
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch { /* 旧版桌面壳没有该 IPC：忽略 */ }
  try { window.dispatchEvent(new CustomEvent(DESKTOP_CALL_EVENT, { detail: now })); } catch { /* 非浏览器环境 */ }
}
