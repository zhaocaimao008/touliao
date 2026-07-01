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
      if (t) timerRef.current = setTimeout(() => setToast(null), 3000);
    };
    _setConfirm = setConfirm;
    return () => { _setToast = null; _setConfirm = null; };
  }, []);

  return (
    <>
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          className={`wc-toast${toast.type === 'error' ? ' error' : toast.type === 'success' ? ' success' : ''}`}
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
