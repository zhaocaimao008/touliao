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
  // 使用 Set 支持多个订阅者（单 ref 后注册会覆盖前者）
  const unreadClearedListeners = useRef(new Set());
  const deliveredListeners     = useRef(new Set());

  const registerUnreadCleared = useCallback((fn) => {
    if (!fn) return;
    unreadClearedListeners.current.add(fn);
    return () => unreadClearedListeners.current.delete(fn);
  }, []);
  const registerDelivered = useCallback((fn) => {
    if (!fn) return;
    deliveredListeners.current.add(fn);
    return () => deliveredListeners.current.delete(fn);
  }, []);

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

    const electronToken = (window.__ELECTRON_CONFIG__ || window.Capacitor?.isNativePlatform?.())
      ? localStorage.getItem('vxin_electron_token')
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

    // 多端同步：另一台设备标记已读 → 通知所有订阅者
    s.on('sync:unread_cleared', (payload) => {
      unreadClearedListeners.current.forEach(fn => fn(payload));
    });

    // 送达回执：消息到达接收方某端
    s.on('message_delivered', (payload) => {
      deliveredListeners.current.forEach(fn => fn(payload));
    });

    // 实时朋友圈（对齐安卓/iOS）：好友发新动态 / 赞了我 / 评论了我
    // 解耦广播 window 事件，朋友圈页挂载时据此刷新 feed / 互动红点。
    ['new_moment', 'moment_liked', 'moment_commented'].forEach((ev) => {
      s.on(ev, (payload) => {
        try { window.dispatchEvent(new CustomEvent('vxin:moment', { detail: { type: ev, payload } })); } catch { /* CustomEvent unsupported; ignore */ }
      });
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
