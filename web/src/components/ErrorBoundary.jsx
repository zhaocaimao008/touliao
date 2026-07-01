import React from 'react';

/**
 * 全局错误边界：捕获子树渲染期/生命周期抛出的 JS 异常，
 * 避免整页白屏（此前 ChatWindow TDZ、登录混合内容均导致过白屏）。
 *
 * - 渲染降级为友好错误页（可重试 / 回首页）
 * - 保留错误日志：console.error + sessionStorage(最近 10 条) + 可选上报后端
 * - React 错误边界必须是 class 组件（无 Hook 等价物）
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // 1. 控制台日志
    console.error('[ErrorBoundary] 捕获到未处理异常:', error, errorInfo);

    // 2. 本地留痕（最近 10 条），便于线上排查/用户反馈
    try {
      const log = {
        time: new Date().toISOString(),
        message: String(error?.message || error),
        stack: String(error?.stack || ''),
        componentStack: String(errorInfo?.componentStack || ''),
        url: typeof location !== 'undefined' ? location.href : '',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      };
      const KEY = 'vxin_error_log';
      const prev = JSON.parse(sessionStorage.getItem(KEY) || '[]');
      prev.unshift(log);
      sessionStorage.setItem(KEY, JSON.stringify(prev.slice(0, 10)));

      // 3. 尽力上报后端（失败静默，不影响降级页）
      if (typeof fetch === 'function') {
        fetch('/api/client-errors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(log),
          keepalive: true,
        }).catch(() => {});
      }
    } catch { /* 留痕失败不阻塞降级 */ }
  }

  handleReload = () => {
    // 优先回到当前页重试；状态复位让子树重新挂载
    this.setState({ hasError: false, error: null });
  };

  handleHome = () => {
    // 回首页（HashRouter 用 #/，BrowserRouter 用 /）；强制刷新确保干净状态
    const isHash = typeof location !== 'undefined' && location.hash.startsWith('#/');
    if (typeof location !== 'undefined') {
      location.href = isHash ? `${location.pathname}#/` : '/';
      location.reload();
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.icon}>😵</div>
          <h1 style={styles.title}>页面出了点小问题</h1>
          <p style={styles.desc}>
            抱歉，刚才的操作触发了一个异常。你可以重试，或返回首页继续使用。
          </p>
          {this.state.error?.message && (
            <pre style={styles.errBox}>{String(this.state.error.message)}</pre>
          )}
          <div style={styles.btnRow}>
            <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={this.handleReload}>
              重试
            </button>
            <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={this.handleHome}>
              返回首页
            </button>
          </div>
          <p style={styles.hint}>若反复出现，请截图反馈给我们（错误已自动记录）。</p>
        </div>
      </div>
    );
  }
}

const styles = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg-secondary, #f5f5f5)', padding: 24, boxSizing: 'border-box',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif",
  },
  card: {
    width: 420, maxWidth: '100%', background: 'var(--bg-panel, #fff)', borderRadius: 16, padding: '40px 32px',
    textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,.08)',
  },
  icon: { fontSize: 56, lineHeight: 1, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)', margin: '0 0 10px' },
  desc: { fontSize: 14, color: 'var(--text-secondary, #666)', lineHeight: 1.6, margin: '0 0 18px' },
  errBox: {
    textAlign: 'left', fontSize: 12, color: 'var(--color-badge, #FA5151)', background: 'var(--bg-secondary, #fdf0ef)',
    border: '1px solid var(--border-color, #f5d5d2)', borderRadius: 8, padding: '10px 12px', margin: '0 0 20px',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'auto',
  },
  btnRow: { display: 'flex', gap: 12, justifyContent: 'center' },
  btn: {
    padding: '10px 22px', borderRadius: 10, fontSize: 14, fontWeight: 500,
    cursor: 'pointer', border: 'none', transition: 'opacity .15s',
  },
  btnPrimary: { background: 'var(--green)', color: 'var(--text-inverse, #fff)' },
  btnGhost: { background: 'var(--bg-hover, #f0f0f0)', color: 'var(--text-primary, #333)' },
  hint: { fontSize: 12, color: 'var(--text-tertiary, #aaa)', margin: '18px 0 0' },
};
