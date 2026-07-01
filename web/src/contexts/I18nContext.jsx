import React, { createContext, useContext, useState, useEffect } from 'react';

const translations = {
  'zh-CN': {
    // 设置
    'settings.appearance': '外观',
    'settings.notifications': '通知',
    'settings.devices': '设备管理',
    'settings.privacy': '隐私与安全',
    'settings.server': '服务器地址',
    'settings.language': '语言',
    'settings.logout': '退出登录',
    'settings.deleteAccount': '注销账号',
    // 外观
    'appearance.light': '日间模式',
    'appearance.dark': '夜间模式',
    'appearance.fontSize': '字体大小',
    'appearance.small': '小',
    'appearance.normal': '标准',
    'appearance.large': '大',
    'appearance.xlarge': '特大',
    // 聊天
    'chat.placeholder': '输入消息…',
    'chat.send': '发送',
    'chat.recall': '撤回',
    'chat.delete': '删除',
    'chat.copy': '复制',
    'chat.forward': '转发',
    'chat.reply': '回复',
    'chat.vanish': '删除不留痕迹',
    // 通用
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.save': '保存',
    'common.back': '返回',
    'common.loading': '加载中…',
    'common.empty': '暂无内容',
    // 语言名
    'lang.zh-CN': '简体中文',
    'lang.en': 'English',
    'lang.zh-TW': '繁體中文',
  },
  'en': {
    'settings.appearance': 'Appearance',
    'settings.notifications': 'Notifications',
    'settings.devices': 'Device Management',
    'settings.privacy': 'Privacy & Security',
    'settings.server': 'Server',
    'settings.language': 'Language',
    'settings.logout': 'Log Out',
    'settings.deleteAccount': 'Delete Account',
    'appearance.light': 'Light Mode',
    'appearance.dark': 'Dark Mode',
    'appearance.fontSize': 'Font Size',
    'appearance.small': 'Small',
    'appearance.normal': 'Normal',
    'appearance.large': 'Large',
    'appearance.xlarge': 'Extra Large',
    'chat.placeholder': 'Type a message...',
    'chat.send': 'Send',
    'chat.recall': 'Recall',
    'chat.delete': 'Delete',
    'chat.copy': 'Copy',
    'chat.forward': 'Forward',
    'chat.reply': 'Reply',
    'chat.vanish': 'Delete without trace',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.save': 'Save',
    'common.back': 'Back',
    'common.loading': 'Loading...',
    'common.empty': 'Nothing here',
    'lang.zh-CN': '简体中文',
    'lang.en': 'English',
    'lang.zh-TW': '繁體中文',
  },
  'zh-TW': {
    'settings.appearance': '外觀',
    'settings.notifications': '通知',
    'settings.devices': '裝置管理',
    'settings.privacy': '隱私與安全',
    'settings.server': '伺服器',
    'settings.language': '語言',
    'settings.logout': '登出',
    'settings.deleteAccount': '登出帳號',
    'appearance.light': '日間模式',
    'appearance.dark': '夜間模式',
    'appearance.fontSize': '字體大小',
    'appearance.small': '小',
    'appearance.normal': '標準',
    'appearance.large': '大',
    'appearance.xlarge': '特大',
    'chat.placeholder': '輸入訊息…',
    'chat.send': '傳送',
    'chat.recall': '收回',
    'chat.delete': '刪除',
    'chat.copy': '複製',
    'chat.forward': '轉發',
    'chat.reply': '回覆',
    'chat.vanish': '刪除不留痕跡',
    'common.cancel': '取消',
    'common.confirm': '確認',
    'common.save': '儲存',
    'common.back': '返回',
    'common.loading': '載入中…',
    'common.empty': '暫無內容',
    'lang.zh-CN': '简体中文',
    'lang.en': 'English',
    'lang.zh-TW': '繁體中文',
  },
};

const I18nContext = createContext({ t: k => k, lang: 'zh-CN', setLang: () => {} });

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('wc_lang') || 'zh-CN');

  const setLang = (l) => {
    setLangState(l);
    localStorage.setItem('wc_lang', l);
  };

  const t = (key, fallback) => {
    const dict = translations[lang] || translations['zh-CN'];
    return dict[key] || translations['zh-CN'][key] || fallback || key;
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
export const SUPPORTED_LANGS = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'en',    name: 'English' },
  { code: 'zh-TW', name: '繁體中文' },
];
