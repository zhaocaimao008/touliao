import { describe, expect, it } from 'vitest';
import { translate } from './translate';
import translations from './translations';
describe('translation compatibility', () => {
  it('retains the three supported dictionaries and core auth/chat strings', () => {
    expect(Object.keys(translations)).toEqual(['zh-CN', 'en', 'zh-TW']);
    for (const lang of Object.keys(translations)) {
      expect(Object.keys(translations[lang]).length).toBeGreaterThan(1000);
      expect(translate(lang, 'common.appName')).toBeTruthy();
      expect(translate(lang, 'home.newMessage')).not.toBe('home.newMessage');
    }
  });
  it('unsupported languages fall back to Chinese', () => {
    expect(translate('unknown', 'common.appName')).toBe('投聊');
  });
  it('missing keys preserve explicit fallback, then the key', () => {
    expect(translate('en', 'absent-key', 'fallback')).toBe('fallback');
    expect(translate('en', 'absent-key')).toBe('absent-key');
  });
});
