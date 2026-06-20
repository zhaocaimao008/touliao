import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getServerUrl } from '../config';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  // 用 ref 保存最新 socket 供 cleanup 使用，避免 stale closure
  const socketRef = useRef(null);

  useEffect(() => {
    // 先断旧连接
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    }

    if (!token) return;

    const s = io(getServerUrl(), {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 15000,
    });

    socketRef.current = s;
    setSocket(s); // ← state 更新，子组件能感知新实例

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('reconnect', () => {
      setConnected(true);
      setReconnectCount(c => c + 1);
    });
    s.on('reconnect_attempt', () => setConnected(false));
    s.on('connect_error', () => setConnected(false));

    return () => {
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [token]); // token 变化（切换账号）→ 断旧建新

  return (
    <SocketContext.Provider value={{ socket, connected, reconnectCount }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
};
