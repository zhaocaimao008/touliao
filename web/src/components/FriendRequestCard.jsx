import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import Avatar from './Avatar';

/**
 * 2026-08-29 好友申请提醒优化新增：App 内轻量提醒卡片（非系统通知、非大弹窗）。
 * 单例 portal 挂载，与 utils/toast.jsx 的 showToast 是同一种模式：模块级 setter + 独立 root。
 * 只在 App 前台可见时使用（后台/隐藏仍走系统 Notification，见 Home.jsx 调用处），
 * 3.5秒后自动收起，支持点击关闭；不遮挡输入框——固定在顶部，不是居中大弹窗。
 */
let _push = null;

function FriendRequestCardRoot() {
  const [item, setItem] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef(null);
  const leaveTimerRef = useRef(null);

  const dismiss = () => {
    clearTimeout(timerRef.current);
    setLeaving(true);
    leaveTimerRef.current = setTimeout(() => { setItem(null); setLeaving(false); }, 200);
  };

  useEffect(() => {
    _push = (next) => {
      clearTimeout(timerRef.current);
      clearTimeout(leaveTimerRef.current);
      setLeaving(false);
      setItem(next);
      timerRef.current = setTimeout(dismiss, 4000);
    };
    return () => { _push = null; clearTimeout(timerRef.current); clearTimeout(leaveTimerRef.current); };
  }, []);

  if (!item) return null;

  return (
    <div
      className={`frc-card${leaving ? ' frc-leaving' : ''}`}
      role="status"
      aria-live="polite"
      data-testid="friend-request-card"
      onClick={() => { item.onView?.(); dismiss(); }}
    >
      <Avatar src={item.avatar} name={item.name} size={40} className="cl-avatar-rounded" />
      <div className="frc-body">
        <div className="frc-title">{item.name}</div>
        <div className="frc-sub">请求添加你为好友</div>
        {item.message ? <div className="frc-msg">{item.message}</div> : null}
      </div>
      <button
        className="frc-view"
        data-testid="friend-request-card-view"
        onClick={(e) => { e.stopPropagation(); item.onView?.(); dismiss(); }}
      >查看</button>
      <button
        className="frc-close"
        aria-label="关闭"
        onClick={(e) => { e.stopPropagation(); dismiss(); }}
      >×</button>
    </div>
  );
}

const container = document.createElement('div');
container.id = 'frc-root';
document.body.appendChild(container);
ReactDOM.createRoot(container).render(<FriendRequestCardRoot />);

/** 显示一条好友申请轻量提醒卡片。onView 由调用方传入（通常是跳转到"新的朋友"）。 */
export function showFriendRequestCard({ avatar, name, message, onView }) {
  _push?.({ avatar, name: name || '有人', message, onView });
}
