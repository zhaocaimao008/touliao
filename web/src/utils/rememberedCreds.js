// ================================================================
// rememberedCreds.js — 仅保存用户选择记住的用户名（手机号），绝不持久化密码。
// ================================================================

const USER_STORE = 'touliao_remembered_users';
const LEGACY_STORES = ['touliao_cred_key', 'touliao_creds_v2', 'touliao_creds_v1'];

function readAll() {
  try {
    LEGACY_STORES.forEach(key => localStorage.removeItem(key));
    return JSON.parse(localStorage.getItem(USER_STORE) || '[]');
  } catch {
    return [];
  }
}

function writeAll(users) {
  try {
    localStorage.setItem(USER_STORE, JSON.stringify(users));
    LEGACY_STORES.forEach(key => localStorage.removeItem(key));
  } catch { /* localStorage 满/隐私模式：静默忽略 */ }
}

// ── 公开 API（全部 async）───────────────────────────────────────

/** 记住用户名（手机号），不保存密码。 */
export async function saveCred(phone) {
  if (!phone) return;
  const users = readAll().filter(item => item !== phone);
  users.push(phone);
  writeAll(users);
}

/** 是否已记住该用户名。 */
export function hasCred(phone) {
  return !!phone && readAll().includes(phone);
}

/** 移除已记住的用户名。 */
export function removeCred(phone) {
  if (!phone) return;
  writeAll(readAll().filter(item => item !== phone));
}

/** 最近一次记住的用户名（登录页默认回填用）。 */
export function lastRememberedPhone() {
  const phones = readAll();
  return phones.length ? phones[phones.length - 1] : '';
}
