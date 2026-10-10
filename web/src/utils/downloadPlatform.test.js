import { describe, expect, it } from 'vitest';
import { preferredDownload } from './downloadPlatform';

describe('download platform presentation', () => {
  it('recommends actual supported platforms', () => {
    expect(preferredDownload({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' })).toBe('android');
    expect(preferredDownload({ userAgentData: { platform: 'Windows' } })).toBe('windows');
    expect(preferredDownload({ platform: 'Win32' })).toBe('windows');
  });
  it('does not recommend a Windows or APK installer on iPhone, desktop-mode iPad, Mac or unknown devices', () => {
    for (const device of [
      { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18)' },
      { platform: 'MacIntel', maxTouchPoints: 5 },
      { platform: 'MacIntel', maxTouchPoints: 0 },
      { platform: 'Linux x86_64' }, {},
    ]) expect(preferredDownload(device)).toBeNull();
  });
});
