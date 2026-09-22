'use strict';
const sensitive = /(?:^|[._-])(authorization|cookies|cookie|set-cookie|password|oldpassword|newpassword|token|access_token|refresh_token|secret|otp|totp|phone)$/i;
const querySecret = /^(token|access_token|refresh_token|signature|x-amz-signature|password|code|otp|totp|phone)$/i;
function redact(value, seen = new WeakSet()) {
  if (typeof value === 'string') return value
    .replace(/(^|[?&])([^=?&#\s"']+)=([^&#\s"']*)/g, (match, prefix, key) => {
      try { return querySecret.test(decodeURIComponent(key)) ? `${prefix}${key}=[REDACTED]` : match; }
      catch { return `${prefix}${key}=[REDACTED]`; }
    })
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const out = Array.isArray(value) ? [] : {};
  for (const key of Object.keys(value)) {
    // Keep diagnostic codes (ENOENT / HTTP / OTEL status), never numeric OTP strings.
    const diagnosticCode = key === 'code' && (typeof value[key] === 'number' && value[key] >= 0 && value[key] <= 599
      || typeof value[key] === 'string' && /^[A-Z][A-Z0-9_]{2,}$/.test(value[key]));
    out[key] = sensitive.test(key) || (key.toLowerCase() === 'code' && !diagnosticCode) ? '[REDACTED]' : redact(value[key], seen);
  }
  return out;
}
module.exports = { redact };
