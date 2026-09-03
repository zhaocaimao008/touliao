import React from 'react';
import { getI18n } from '../contexts/I18nContext';

/**
 * PanelBoundary — 面板级轻量错误边界
 * 捕获 Moments / Collections / CallHistory 等懒加载面板的渲染异常，
 * 仅让当前面板降级，不影响聊天主区和侧边栏。
 * class 组件无 Hook，翻译走模块级 getI18n() 快照（与 ChatWindowBoundary 同类问题）。
 */
export default class PanelBoundary extends React.Component {
  state = { err: null };

  static getDerivedStateFromError(e) { return { err: e }; }

  componentDidCatch(e, info) {
    try {
      fetch('/api/client-errors', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time: new Date().toISOString(),
          panel: this.props.name || 'unknown',
          message: String(e?.message || e),
          componentStack: String(info?.componentStack || ''),
        }),
      }).catch(() => {});
    } catch { /* 静默 */ }
  }

  render() {
    if (!this.state.err) return this.props.children;
    const t = getI18n();
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 12,
        color: 'var(--text-secondary)', fontSize: 'var(--text-sm)',
      }}>
        <span style={{ fontSize: 32 }}>⚠️</span>
        <span>{t('panelBoundary.loadErrorTemplate').replace('{panel}', this.props.name || t('panelBoundary.defaultPanelName'))}</span>
        <button
          onClick={() => this.setState({ err: null })}
          style={{
            padding: '6px 18px', borderRadius: 'var(--radius-input)',
            border: 'none', background: 'var(--bg-hover)',
            color: 'var(--text-primary)', cursor: 'pointer',
            fontSize: 'var(--text-sm)',
          }}
        >{t('common.retry')}</button>
      </div>
    );
  }
}
