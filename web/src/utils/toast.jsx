import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { getI18n } from '../contexts/I18nContext';

let _setToast = null;
let _setConfirm = null;

function ToastRoot() {
  // ToastRoot 挂在独立的 ReactDOM root 上（在 I18nProvider 之外），拿不到 useI18n()。
  // 用 getI18n() 的快照式取词：每次渲染重取，弹窗都是即时打开的，够用。
  // 修复此前「取消/确认/点击关闭」三处硬编码简中——英文/繁中用户在每个确认弹窗
  // 都会看到简体中文按钮。
  const t = getI18n();
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
          title={t('common.close')}
          style={{
            animation: 'toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >{toast.msg}</div>
      )}
      {confirmState && (
        <div
          className="wc-confirm-overlay"
          onClick={e => { if (e.target === e.currentTarget) { confirmState.resolve(false); setConfirm(null); } }}
          style={{
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <div
            className="wc-confirm-box"
            role="dialog"
            aria-modal="true"
            aria-label={t('common.confirm')}
            style={{
              animation: 'scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div className="wc-confirm-msg">{confirmState.msg}</div>
            <div className="wc-confirm-btns">
              <button
                className="wc-confirm-cancel"
                data-testid="confirm-cancel"
                onClick={() => { confirmState.resolve(false); setConfirm(null); }}
                style={{ transition: 'all 0.15s ease' }}
              >{t('common.cancel')}</button>
              <button
                className="wc-confirm-ok"
                data-testid="confirm-ok"
                onClick={() => { confirmState.resolve(true); setConfirm(null); }}
                style={{ transition: 'all 0.15s ease' }}
              >{t('common.confirm')}</button>
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
