export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') ||
      value.includes('\\') || [...value].some(character => character.charCodeAt(0) <= 32)) return '/';
  const base = 'https://touliao.invalid';
  try {
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch { return '/'; }
}
