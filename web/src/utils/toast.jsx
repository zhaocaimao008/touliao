import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import TouliaoDialog from '../ui-kit/Dialog';
import { getI18n } from '../contexts/I18nContext';
import { feedbackDuration } from '../ui-kit/feedbackPolicy';

let _setToast = null;
let _setConfirm = null;
// ToastRoot 挂载前发出的提示先暂存（页面刚加载时组件的 effect 比 ToastRoot 先跑，
// 如登录页的「请先登录」「登录已失效」），挂载后补显示，而不是静默丢弃
let _pendingToast = null;

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
        timerRef.current = setTimeout(() => setToast(null), feedbackDuration(t.msg, t.type));
      }
    };
    _setConfirm = setConfirm;
    if (_pendingToast) { _setToast(_pendingToast); _pendingToast = null; }
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
            animation: 'toastSlideIn var(--tl-duration-normal) var(--tl-easing-entrance)',
          }}
        >{toast.msg}</div>
      )}
      {confirmState && <TouliaoDialog
        {...confirmState.options} message={confirmState.msg}
        onCancel={() => { confirmState.resolve(false); setConfirm(null); }}
        onConfirm={() => { confirmState.resolve(true); setConfirm(null); }}
      />}

    </>
  );
}

// Mount once
const container = document.createElement('div');
container.id = 'wc-toast-root';
document.body.appendChild(container);
ReactDOM.createRoot(container).render(<ToastRoot />);

export function showToast(msg, type = 'info') {
  if (_setToast) _setToast({ msg, type });
  else _pendingToast = { msg, type };
}

export function showConfirm(msg, options = {}) {
  return new Promise(resolve => {
    _setConfirm?.({ msg, resolve, options });
  });
}
