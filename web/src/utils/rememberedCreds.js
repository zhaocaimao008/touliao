// ================================================================
// rememberedCreds.js — 「记住密码」本地凭证存储
// ----------------------------------------------------------------
// 安全等级升级：XOR混淆 → SubtleCrypto AES-256-GCM 真加密
//
// 方案：
//   · 设备绑定密钥（Device Key）：首次使用时随机生成 AES-256-GCM CryptoKey，
//     导出为 raw bytes 存于 localStorage[touliao_cred_key]。
//     密钥与密文同设备同浏览器绑定，跨设备无法解密。
//   · 每次加密使用随机 12-byte IV（GCM nonce），防重放/已知明文攻击。
//   · 密文格式：`v2:<base64(iv + ciphertext)>`，可与旧 v1 XOR 格式区分。
//   · 向下兼容：读取时若发现 v1 格式，透明迁移到 v2。
//
// ⚠ 安全边界（仍须知悉）：
//   · Device Key 与密文均存于 localStorage，能 dump localStorage 的
//     攻击者（如 XSS）同时拿到 key 和密文，仍可解密。
//   · 真正的防线是 CSP + httpOnly Cookie + 不存密码（用 Bearer token）。
//   · 本功能仅为登录页「自动回填」便利性，用户主动勾选才启用。
//   · AES-GCM 相对 XOR 的提升：防离线暴力、防彩虹表、密文不可伪造。
//
// 存储：
//   localStorage['touliao_cred_key']  = base64(deviceKey raw bytes)
//   localStorage['touliao_creds_v2']  = JSON({ [phone]: "v2:<b64>" })
// ================================================================

const KEY_STORE  = 'touliao_cred_key';   // 设备密钥
const CRED_STORE = 'touliao_creds_v2';   // 加密凭证（新）
const CRED_OLD   = 'touliao_creds_v1';   // 旧 XOR 凭证（向下兼容读取）

// ── 设备密钥管理 ────────────────────────────────────────────────

/** 从 localStorage 加载或新建设备 AES-256-GCM 密钥 */
async function getDeviceKey() {
  try {
    const stored = localStorage.getItem(KEY_STORE);
    if (stored) {
      const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
      return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
  } catch { /* 损坏则重新生成 */ }

  // 生成新密钥
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  localStorage.setItem(KEY_STORE, btoa(String.fromCharCode(...new Uint8Array(raw))));
  return key;
}

// ── AES-GCM 加解密 ──────────────────────────────────────────────

async function encrypt(plaintext) {
  const key = await getDeviceKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12)); // 96-bit GCM nonce
  const enc = new TextEncoder();
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));

  // 打包：iv(12B) + ciphertext
  const packed = new Uint8Array(12 + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), 12);
  return 'v2:' + btoa(String.fromCharCode(...packed));
}

async function decrypt(stored) {
  // v2 格式
  if (stored.startsWith('v2:')) {
    try {
      const key    = await getDeviceKey();
      const packed = Uint8Array.from(atob(stored.slice(3)), c => c.charCodeAt(0));
      const iv     = packed.slice(0, 12);
      const ct     = packed.slice(12);
      const pt     = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return new TextDecoder().decode(pt);
    } catch {
      return ''; // 密钥不匹配（换设备/清 key）→ 回填失败，用户重新输入
    }
  }

  // v1 格式（旧 XOR，兼容读取）
  try {
    const OBF_KEY = 'vxin::remember::v1';
    const s = atob(String(stored));
    let out = '';
    for (let i = 0; i < s.length; i++) {
      out += String.fromCharCode(s.charCodeAt(i) ^ OBF_KEY.charCodeAt(i % OBF_KEY.length));
    }
    return decodeURIComponent(escape(out));
  } catch {
    return '';
  }
}

// ── localStorage 读写 ────────────────────────────────────────────

function readAll() {
  try {
    const v2 = JSON.parse(localStorage.getItem(CRED_STORE) || '{}');
    const v1 = JSON.parse(localStorage.getItem(CRED_OLD)   || '{}');
    // 合并：v2 优先，v1 作为兜底（首次读时迁移用）
    return { ...v1, ...v2 };
  } catch {
    return {};
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(CRED_STORE, JSON.stringify(map));
    // 写入成功后清除旧 v1 存储
    localStorage.removeItem(CRED_OLD);
  } catch { /* localStorage 满/隐私模式：静默忽略 */ }
}

// ── 公开 API（全部 async）───────────────────────────────────────

/** 保存手机号对应密码（AES-256-GCM 加密）*/
export async function saveCred(phone, password) {
  if (!phone || !password) return;
  try {
    const map = readAll();
    map[phone] = await encrypt(password);
    writeAll(map);
  } catch { /* 加密失败静默，不影响登录流程 */ }
}

/** 读取手机号已保存的密码；无/解密失败均返回 '' */
export async function loadCred(phone) {
  if (!phone) return '';
  try {
    const stored = readAll()[phone];
    if (!stored) return '';
    return await decrypt(stored);
  } catch {
    return '';
  }
}

/** 是否存在该手机号的已保存密码 */
export function hasCred(phone) {
  return !!phone && !!readAll()[phone];
}

/** 移除手机号的已保存密码（退出/取消勾选时调用）*/
export function removeCred(phone) {
  if (!phone) return;
  const map = readAll();
  if (phone in map) {
    delete map[phone];
    writeAll(map);
  }
}

/** 最近一次记住密码的手机号（登录页默认回填用）*/
export function lastRememberedPhone() {
  const phones = Object.keys(readAll());
  return phones.length ? phones[phones.length - 1] : '';
}
