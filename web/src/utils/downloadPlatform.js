/** UA hints affect presentation only; every available download remains reachable. */
export function preferredDownload(device = {}) {
  const ua = device.userAgent || '';
  const platform = device.userAgentData?.platform || device.platform || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform) && device.maxTouchPoints > 1)) return null;
  if (/Android/i.test(ua + ' ' + platform)) return 'android';
  if (/Windows|Win32|Win64/i.test(ua + ' ' + platform)) return 'windows';
  return null;
}
