import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { getConfig } from '../utils/config';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket]           = useState(null);
  const [connected, setConnected]     = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const disconnectAtRef   = useRef(0);
  const everConnectedRef  = useRef(false);

  // 多端同步：其他设备读了某会话 → 本设备清零该会话未读
  const onUnreadClearedRef = useRef(null);
  // 送达回执回调
  const onDeliveredRef = useRef(null);

  const registerUnreadCleared = useCallback((fn) => { onUnreadClearedRef.current = fn; }, []);
  const registerDelivered      = useCallback((fn) => { onDeliveredRef.current = fn; }, []);

  useEffect(() => {
    if (!user) { setSocket(null); setConnected(false); return; }

    // ── 服务器地址优先级 ────────────────────────────
    // 1. 运行时手动切换（localStorage，由 Login 页面的"切换服务器"功能设置）
    // 2. 远程配置 Config.socket
    // 3. Vite 环境变量（开发模式）
    // 4. 空值 → 使用同源相对路径
    const manualUrl = localStorage.getItem('vxin_server_url');
    const cfg = getConfig();
    const serverUrl = manualUrl || cfg.socket || import.meta.env.VITE_SERVER_URL || import.meta.env.VITE_API_BASE || '/';

    const electronToken = window.__ELECTRON_CONFIG__
      ? sessionStorage.getItem('vxin_electron_token')
      : null;

    const s = io(serverUrl, {
      transports: ['websocket'],
      withCredentials: true,
      ...(electronToken ? { auth: { token: electronToken } } : {}),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    setSocket(s);
    if (typeof window !== 'undefined') window.__vxinSocket = s;

    s.on('connect', () => {
      setConnected(true);
      if (everConnectedRef.current) {
        setReconnectCount(n => n + 1);
      }
      everConnectedRef.current = true;
    });

    s.on('disconnect', () => {
      setConnected(false);
      disconnectAtRef.current = Math.floor(Date.now() / 1000);
    });

    // 多端同步：另一台设备标记已读 → 通知本设备
    s.on('sync:unread_cleared', (payload) => {
      onUnreadClearedRef.current?.(payload);
    });

    // 送达回执：消息到达接收方某端
    s.on('message_delivered', (payload) => {
      onDeliveredRef.current?.(payload);
    });

    // 页面从后台恢复（手机息屏、PC 锁屏、切 Tab）时强制重连
    // visibilitychange 比 focus/online 更可靠
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !s.connected) {
        s.connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    // 网络从离线恢复时重连
    const onOnline = () => { if (!s.connected) s.connect(); };
    window.addEventListener('online', onOnline);

    return () => {
      everConnectedRef.current = false;
      disconnectAtRef.current = 0;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id]);

  return (
    <SocketContext.Provider value={{
      socket,
      connected,
      reconnectCount,
      disconnectAtRef,
      registerUnreadCleared,
      registerDelivered,
    }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
