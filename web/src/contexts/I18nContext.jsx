import React, { createContext, useContext, useState, useEffect } from 'react';

import translations from '../i18n/translations';
import { translate } from '../i18n/translate';

const I18nContext = createContext({ t: k => k, lang: 'zh-CN', setLang: () => {} });

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    // 校验存储值:旧版本/被篡改可能残留不支持的语言码(如 'ja'),会让 <html lang> 与词典错位
    const saved = localStorage.getItem('wc_lang');
    return translations[saved] ? saved : 'zh-CN';
  });

  const setLang = (l) => {
    if (!translations[l]) return;   // 只接受受支持的语言,避免切到空词典
    setLangState(l);
    localStorage.setItem('wc_lang', l);
  };

  const t = (key, fallback) => {
    return translate(lang, key, fallback);
  };

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  return (
    <I18nContext.Provider value={{ t, lang, setLang, translations }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);

// class 组件（错误边界等）没有 Hook，无法用 useI18n()；这里给一个一次性快照式
// 取词函数，读取与 Provider 相同的 localStorage 语言设置。不订阅后续切换语言，
// 因为调用方（PanelBoundary/ChatWindowBoundary/ErrorBoundary）只在渲染出错这个
// 离散事件里取词，不需要语言切换时的实时刷新。
export function getI18n() {
  const saved = localStorage.getItem('wc_lang');
  const lang = translations[saved] ? saved : 'zh-CN';
  return (key, fallback) => translate(lang, key, fallback);
}
export const SUPPORTED_LANGS = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'en',    name: 'English' },
  { code: 'zh-TW', name: '繁體中文' },
];
