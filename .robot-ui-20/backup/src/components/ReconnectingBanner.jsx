import React, { useEffect, useState, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';

/**
 * 断线重连提示条。socket 断开超过 2s 仍未恢复才显示，避免初次连接/瞬断闪烁。
 * 固定在顶部，两端（桌面 + 移动）通用。
 * 恢复连接后不直接消失，而是短暂闪现一条绿色「网络已恢复」，给用户一个确定的收尾反馈，
 * ~2s 后自动收起（对齐一线 App 的「断—连」闭环体感）。
 */
export default function ReconnectingBanner() {
  const { connected } = useSocket();
  const [state, setState] = useState('hidden');   // hidden | reconnecting | restored
  const wasShownRef = useRef(false);              // 是否真实展示过「断开」提示

  useEffect(() => {
    if (!connected) {
      // 断开：延迟 2s 再显示，避开瞬断闪烁
      const t = setTimeout(() => { setState('reconnecting'); wasShownRef.current = true; }, 2000);
      return () => clearTimeout(t);
    }
    // 已连接：仅当之前确实展示过「断开」才闪一下「已恢复」，否则直接隐藏
    if (wasShownRef.current) {
      wasShownRef.current = false;
      setState('restored');
      const t = setTimeout(() => setState('hidden'), 2000);
      return () => clearTimeout(t);
    }
    setState('hidden');
  }, [connected]);

  if (state === 'hidden') return null;
  const restored = state === 'restored';
  // Electron 自定义标题栏固定在 top:0 高 30px，提示条需下移避免被遮住
  const isElectron = !!window.__ELECTRON_CONFIG__;
  return (
    <div
      className={`wc-net-banner${isElectron ? ' electron' : ''}${restored ? ' restored' : ''}`}
      role="status"
      aria-live="polite"
      data-testid="net-banner"
      data-state={state}
    >
      <span className="wc-net-banner-dot" />
      {restored ? '网络已恢复' : '网络连接已断开，正在重连…'}
    </div>
  );
}
