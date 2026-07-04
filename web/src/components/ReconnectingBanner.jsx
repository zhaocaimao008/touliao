import React, { useEffect, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';

/**
 * 断线重连提示条。socket 断开超过 2s 仍未恢复才显示，避免初次连接/瞬断闪烁。
 * 固定在顶部，两端（桌面 + 移动）通用，恢复连接后自动收起。
 */
export default function ReconnectingBanner() {
  const { connected } = useSocket();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (connected) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 2000);
    return () => clearTimeout(t);
  }, [connected]);

  if (!show) return null;
  // Electron 自定义标题栏固定在 top:0 高 30px，提示条需下移避免被遮住
  const isElectron = !!window.__ELECTRON_CONFIG__;
  return (
    <div className={`wc-net-banner${isElectron ? ' electron' : ''}`} role="status" aria-live="polite">
      <span className="wc-net-banner-dot" />
      网络连接已断开，正在重连…
    </div>
  );
}
