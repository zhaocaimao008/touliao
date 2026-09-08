import translations from './translations';
export function translate(lang, key, fallback) {
  return translations[lang]?.[key] || translations['zh-CN'][key] || fallback || key;
}
