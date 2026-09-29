import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../contexts/I18nContext';
// 品牌图标光学尺寸版本（assets/brand/touliao/sizes），按屏幕缩放挑最接近的一张，
// 避免浏览器把大图缩到 16px 糊掉；用 import 而非 /favicon 路径，桌面端是 file:// 加载。
import brandIcon16 from '../assets/brand/touliao-16.png';
import brandIcon24 from '../assets/brand/touliao-24.png';
import brandIcon32 from '../assets/brand/touliao-32.png';

// 品牌主色（极光靛）：标题栏左侧图标/文字点缀，与 Web 设计 token 对齐
const BRAND = '#6D5AE6';

function WinBtn({ onClick, isClose, children, title }) {
  const [hov, setHov] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      title={title}
      aria-label={title}
      style={{
        width: 48, height: 30, border: 'none',
        // 无障碍：键盘 Tab 聚焦时显示 2px 对比色焦点环（此前 outline:none 无焦点样式）
        outline: focused ? `2px solid ${BRAND}` : 'none',
        outlineOffset: -2,
        background: hov ? (isClose ? 'var(--titlebar-close-hover)' : 'var(--titlebar-btn-hover-bg)') : 'transparent',
        color: hov ? 'var(--titlebar-fg-hover)' : 'var(--titlebar-fg)',
        cursor: 'pointer', fontSize: 'var(--text-base)', transition: 'background .1s, color .1s',
        WebkitAppRegion: 'no-drag',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', zIndex: "calc(var(--z-native) + 1)",
      }}
    >{children}</button>
  );
}

export default function ElectronTitlebar() {
  const { t } = useI18n();
  const [isMaximized, setIsMaximized] = useState(false);
  // 跟随 Windows 系统深浅主题（主进程 nativeTheme 推送）
  const [sysDark, setSysDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
  const barRef = useRef(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    document.documentElement.classList.add('electron-app');

    // 查询初始窗口状态（ipcRenderer.invoke → Promise）
    api.isMaximized?.().then(setIsMaximized).catch(() => {});
    // 查询系统主题初始值
    api.isDarkTheme?.().then(setSysDark).catch(() => {});

    // preload 将 IPC maximize/unmaximize 事件转为 CustomEvent
    const maxHandler = (e) => setIsMaximized(e.detail);
    const themeHandler = (e) => setSysDark(!!e.detail);
    window.addEventListener('electron:maximized-change', maxHandler);
    window.addEventListener('electron:native-theme-changed', themeHandler);

    // Alt+Space：frame:false 时系统菜单失效，捕获后调主进程弹近似菜单
    const keyHandler = (e) => {
      if (e.altKey && (e.code === 'Space' || e.key === ' ')) {
        e.preventDefault();
        api.showSystemMenu?.().catch(() => {});
      }
    };
    window.addEventListener('keydown', keyHandler);

    return () => {
      document.documentElement.classList.remove('electron-app');
      window.removeEventListener('electron:maximized-change', maxHandler);
      window.removeEventListener('electron:native-theme-changed', themeHandler);
      window.removeEventListener('keydown', keyHandler);
    };
  }, []);

  if (!window.__ELECTRON_CONFIG__) return null;

  const api = window.electronAPI;
  // minimize / maximize / close 均为 ipcRenderer.invoke，返回 Promise
  const handleMin   = () => { api?.minimize?.().catch?.(() => {}); };
  const handleMax   = () => { api?.maximize?.().catch?.(() => {}); };
  const handleClose = () => { api?.close?.().catch?.(() => {});   };

  return (
    <div
      id="touliao-titlebar"
      ref={barRef}
      // 双击标题栏切换最大化/还原（Windows 原生行为）
      onDoubleClick={(e) => {
        // 按钮区双击不触发（避免点关闭按钮时误触）
        if (e.target.closest('button')) return;
        handleMax();
      }}
      data-sys-theme={sysDark ? 'dark' : 'light'}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 30,
        background: 'var(--titlebar-bg)', zIndex: "calc(var(--z-native) - 1)",
        WebkitAppRegion: 'drag',
        display: 'flex', alignItems: 'center',
        userSelect: 'none',
      }}
    >
      <span style={{
        display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12,
        WebkitAppRegion: 'drag',
      }}>
        <img
          src={brandIcon16}
          srcSet={`${brandIcon16} 1x, ${brandIcon24} 1.5x, ${brandIcon32} 2x`}
          width={16} height={16} alt="" aria-hidden="true" draggable={false}
          style={{ flexShrink: 0, display: 'block' }}
        />
        <span style={{
          fontSize: 'var(--text-sm)', letterSpacing: 0,
          color: 'var(--titlebar-title)',
        }}>
          {t('common.appName')}
        </span>
      </span>
      <span style={{ flex: 1, WebkitAppRegion: 'drag' }} />

      <div style={{
        display: 'flex', height: '100%',
        WebkitAppRegion: 'no-drag',
        position: 'relative', zIndex: "var(--z-native)",
      }}>
        <WinBtn onClick={handleMin} title={t('titlebar.minimize')}>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" rx="0.5"/>
          </svg>
        </WinBtn>

        <WinBtn onClick={handleMax} title={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')}>
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="3" y="1" width="8" height="8" rx="1"/>
              <rect x="1.5" y="3.5" width="8" height="8" rx="1" fill="var(--titlebar-bg)" stroke="currentColor"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1.5" y="1.5" width="9" height="9" rx="1"/>
            </svg>
          )}
        </WinBtn>

        <WinBtn isClose onClick={handleClose} title={t('common.close')}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="2" y1="2" x2="10" y2="10"/>
            <line x1="10" y1="2" x2="2" y2="10"/>
          </svg>
        </WinBtn>
      </div>
    </div>
  );
}
