// 被动登出（别处改密码 / 设备被移除 / 封禁 / 会话过期）的原因：跳登录页前暂存，登录页读出来提示一次，
// 否则用户只看到突然回到登录页，不知道发生了什么。
const KEY = 'touliao_logout_reason';
export const GENERIC_LOGOUT_REASON = '__generic__';

export function setLogoutReason(text) {
  try { sessionStorage.setItem(KEY, text || GENERIC_LOGOUT_REASON); } catch { /* 隐私模式等 */ }
}
export function hasLogoutReason() {
  try { return sessionStorage.getItem(KEY) != null; } catch { return false; }
}
export function clearLogoutReason() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
export function takeLogoutReason() {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v;
  } catch { return null; }
}
