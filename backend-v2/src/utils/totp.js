'use strict';
/**
 * TOTP（RFC 6238）—— 与 Google Authenticator / 微软 Authenticator 完全兼容。
 * SHA1 / 30秒步长 / 6位。不依赖第三方库，仅用 Node crypto。
 */
const crypto = require('crypto');

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ── Base32（RFC 4648）──
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/,'').replace(/\s/g,'');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// 生成新密钥（20 字节 → base32），供绑定使用
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// otpauth:// URL —— 扫码绑定用
function otpauthURL(secret, { label = 'v信后台', issuer = 'v信' } = {}) {
  const l = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${l}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// 计算某时间步的 6 位码
function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset+1] & 0xff) << 16) |
               ((hmac[offset+2] & 0xff) << 8) | (hmac[offset+3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

// 校验码：允许 ±1 个时间步（容忍时钟漂移）
function verify(secret, token, window = 1) {
  return verifyWithCounter(secret, token, window, 0).valid;
}

// 校验并返回匹配的时间步计数器（用于防重放攻击）
function verifyWithCounter(secret, token, window = 1, minCounter = 0) {
  if (!secret || !/^\d{6}$/.test(String(token || '').trim())) return { valid: false, counter: null };
  const secretBuf = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const t = String(token).trim();
  for (let i = -window; i <= window; i++) {
    const c = counter + i;
    if (c <= minCounter) continue; // 拒绝已消耗的时间步
    const expected = hotp(secretBuf, c);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(t))) return { valid: true, counter: c };
  }
  return { valid: false, counter: null };
}

module.exports = { generateSecret, otpauthURL, verify, verifyWithCounter };
