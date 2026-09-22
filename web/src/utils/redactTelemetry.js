const sensitive = /^(authorization|cookies|cookie|set-cookie|password|oldpassword|newpassword|token|access_token|refresh_token|secret|code|otp|totp|phone)$/i;
export function redact(value, seen = new WeakSet()) {
  if (typeof value === 'string') return value
    .replace(/((?:^|[?&])(?:token|access_token|refresh_token|signature|x-amz-signature)=)[^&#\s"']*/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const out = Array.isArray(value) ? [] : {};
  for (const key of Object.keys(value)) out[key] = sensitive.test(key) ? '[REDACTED]' : redact(value[key], seen);
  return out;
}
