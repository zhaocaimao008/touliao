import React from 'react';

/**
 * ChatWindow 专属错误边界。
 *
 * 与 App 级 ErrorBoundary 的区别：
 *  - 错误 UI 内嵌在聊天区域内（不撑满 100vh），其余布局（侧边栏、列表）保持可用
 *  - convId prop 变化（切换会话）时自动清除错误状态，无需 key 触发完整卸载
 *  - 只有"重试"一个操作，不跳首页
 */
export default class ChatWindowBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // [ChatWindowBoundary] 捕获异常 — suppressed (keep fetch report)
    // 静默上报，不影响降级 UI
    try {
      fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time: new Date().toISOString(),
          message: String(error?.message || error),
          stack: String(error?.stack || ''),
          componentStack: String(info?.componentStack || ''),
          url: typeof location !== 'undefined' ? location.href : '',
        }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* 上报失败静默 */ }
  }

  componentDidUpdate(prevProps) {
    // 切换会话时自动重置，不需要外部 key 触发完整卸载
    if (this.state.hasError && prevProps.convId !== this.props.convId) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={styles.wrap}>
        <div style={styles.inner}>
          <div style={styles.icon}>⚠️</div>
          <p style={styles.msg}>消息加载出错</p>
          {this.state.error?.message && (
            <pre style={styles.detail}>{String(this.state.error.message)}</pre>
          )}
          <button
            style={styles.btn}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            重试
          </button>
        </div>
      </div>
    );
  }
}

const styles = {
  wrap: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-secondary, #F5F5F5)',
    minHeight: 0,
  },
  inner: {
    textAlign: 'center',
    padding: '24px 32px',
    background: 'var(--bg-panel, #fff)',
    borderRadius: 12,
    boxShadow: '0 2px 16px rgba(0,0,0,.08)',
    maxWidth: 320,
  },
  icon: { fontSize: 36, marginBottom: 12 },
  msg: {
    fontSize: 14,
    color: 'var(--text-secondary, #555)',
    margin: '0 0 12px',
  },
  detail: {
    textAlign: 'left',
    fontSize: 11,
    color: 'var(--color-badge, #FA5151)',
    background: 'var(--bg-secondary, #fdf0ef)',
    border: '1px solid var(--border-color, #f5d5d2)',
    borderRadius: 6,
    padding: '8px 10px',
    margin: '0 0 14px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: 80,
    overflow: 'auto',
  },
  btn: {
    padding: '8px 20px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none',
    background: 'var(--green)',
    color: 'var(--text-inverse)',
  },
};
