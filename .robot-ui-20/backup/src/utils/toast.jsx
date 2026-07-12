import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

let _setToast = null;
let _setConfirm = null;

function ToastRoot() {
  const [toast, setToast] = useState(null);
  const [confirmState, setConfirm] = useState(null);
  const timerRef = React.useRef(null);

  useEffect(() => {
    _setToast = (t) => {
      setToast(t);
      clearTimeout(timerRef.current);
      if (t) {
        // 错误停留更久(4.5s),便于阅读;普通/成功 3s;长文案再按字数适当延长
        const base = t.type === 'error' ? 4500 : 3000;
        const extra = Math.min(2000, Math.max(0, (String(t.msg).length - 20) * 60));
        timerRef.current = setTimeout(() => setToast(null), base + extra);
      }
    };
    _setConfirm = setConfirm;
    return () => { _setToast = null; _setConfirm = null; clearTimeout(timerRef.current); };
  }, []);

  return (
    <>
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          className={`wc-toast${toast.type === 'error' ? ' error' : toast.type === 'success' ? ' success' : ''}`}
          onClick={() => { clearTimeout(timerRef.current); setToast(null); }}
          title="点击关闭"
        >{toast.msg}</div>
      )}
      {confirmState && (
        <div className="wc-confirm-overlay" onClick={e => { if (e.target === e.currentTarget) { confirmState.resolve(false); setConfirm(null); } }}>
          <div className="wc-confirm-box" role="dialog" aria-modal="true" aria-label="确认">
            <div className="wc-confirm-msg">{confirmState.msg}</div>
            <div className="wc-confirm-btns">
              <button className="wc-confirm-cancel" data-testid="confirm-cancel" onClick={() => { confirmState.resolve(false); setConfirm(null); }}>取消</button>
              <button className="wc-confirm-ok" data-testid="confirm-ok" onClick={() => { confirmState.resolve(true); setConfirm(null); }}>确认</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Mount once
const container = document.createElement('div');
container.id = 'wc-toast-root';
document.body.appendChild(container);
ReactDOM.createRoot(container).render(<ToastRoot />);

export function showToast(msg, type = 'info') {
  _setToast?.({ msg, type });
}

export function showConfirm(msg) {
  return new Promise(resolve => {
    _setConfirm?.({ msg, resolve });
  });
}
