import { clearCache, removeFromCache } from '../utils/msgCache';
import { clientStorage as localStorage } from '../utils/clientStorage';
import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { useAuth } from './AuthContext';
import { getConfig, isConfigLoaded } from '../utils/config';
import { isBearerClient, isIsolatedWindow } from '../utils/clientStorage';
import { setLogoutReason, clearLogoutReason, hasLogoutReason } from '../utils/logoutReason';

// 拆分成两个 context 避免 reconnect 引起无关组件 re-render：
// SocketCoreContext  — socket 实例 + 稳定回调（重连时不变）
// SocketStatusContext — connected + reconnectCount（重连时变）
const SocketCoreContext   = createContext(null);
const SocketStatusContext = createContext({ connected: false, reconnectCount: 0 });

export const SocketProvider = ({ children }) => {
  const { user, updateUser } = useAuth();
  // updateUser 每次渲染都是新函数：经 ref 读取，避免放进 socket effect 依赖导致重连
  const updateUserRef = useRef(updateUser);
  useEffect(() => { updateUserRef.current = updateUser; }, [updateUser]);
  const [socket, setSocket]           = useState(null);
  const [connected, setConnected]     = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const disconnectAtRef   = useRef(0);
  const everConnectedRef  = useRef(false);

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

  const userId = user?.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!userId) { setSocket(null); setConnected(false); return; }

    const manualUrl = localStorage.getItem('touliao_server_url');
    // FE-001 之后 config 可能尚未加载完成（Web 端 800ms 超时降级），
    // 此处必须容错：未加载时退到环境变量/同源，避免 getConfig() 抛异常炸掉 Socket 上下文
    const cfg = isConfigLoaded() ? getConfig() : null;
    const serverUrl = manualUrl || cfg?.socket || import.meta.env.VITE_SERVER_URL || import.meta.env.VITE_API_BASE || '/';

    const isDesktop = !!(window.__ELECTRON_CONFIG__ || window.Capacitor?.isNativePlatform?.());
    const electronToken = isBearerClient() ? localStorage.getItem('touliao_electron_token') : null;

    // platform 供服务端按平台维度判定在线（来电推送兜底不因同账号 Web 在线而被压制，
    // 见 backend-v2/src/realtime/presence.js onlinePlatforms）
    const s = io(serverUrl, {
      transports: ['websocket'],
      withCredentials: true,
      auth: { platform: isDesktop ? 'desktop' : 'web', isolated: isIsolatedWindow(), ...(electronToken ? { token: electronToken } : {}) },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    setSocket(s);
    if (typeof window !== 'undefined') window.__touliaoSocket = s;

    s.on('connect', () => {
      setConnected(true);
      if (everConnectedRef.current) setReconnectCount(n => n + 1);
      everConnectedRef.current = true;
    });
    // 核验会话：发一次需鉴权的请求，失效则由 axios 拦截器走既有的刷新 token / 回登录页流程；
    // 仍有效（如本设备刚改完密码、Cookie 已续期）则把被服务端断开的连接接回来。
    let expiredNotified = false; // 服务端明确通知过会话失效：保留其原因，核验通过也不清（见下）
    const verifySession = (reason) => {
      if (reason && !hasLogoutReason()) setLogoutReason(reason); // 先到的原因最准确（如「密码已修改」），不被随后的重连报错覆盖
      axios.get('/api/auth/me')
        .then(() => { if (!expiredNotified) clearLogoutReason(); if (!s.connected && !s.active) s.connect(); })
        .catch(() => {});
    };
    s.on('disconnect', (reason) => {
      setConnected(false);
      disconnectAtRef.current = Math.floor(Date.now() / 1000);
      // 服务端主动断开（改密码 / 移除设备 / 封禁都会踢掉全部连接）时 socket.io 不会自动重连，
      // 页面却一直显示「正在重连」。这里核验一次：失效就回登录页，没失效就重连。
      if (reason === 'io server disconnect') verifySession();
    });
    // 会话失效（别处改密码/退出/token 到期）：服务端随即断开且不会自动重连。
    // 改密码时服务端先通知再落库（为了尽快断开），立刻核验可能还查到旧会话：稍等再核验
    s.on('session_expired', (payload) => {
      expiredNotified = true;
      if (payload?.reason && !hasLogoutReason()) setLogoutReason(payload.reason);
      setTimeout(() => verifySession(), 1500);
    });
    // 重连握手被拒（原因来自服务端鉴权：密码已修改 / 会话已失效 / 账号已被封禁 …）：
    // 不再无限重试，核验后按原因登出
    s.on('connect_error', (err) => {
      const msg = err?.message || '';
      if (/未授权|失效|重新登录|封禁|Token无效|用户不存在/.test(msg)) verifySession(msg);
    });
    // 本账号在其他设备改了昵称/头像：同步到这台设备（「我」页、发出的新消息署名）
    s.on('user_profile_updated', (p) => {
      if (p?.userId === userId) updateUserRef.current?.({ username: p.username, avatar: p.avatar });
    });
    s.on('sync:unread_cleared', (payload) => {
      unreadClearedListeners.current.forEach(fn => fn(payload));
    });
    s.on('conversation_messages_cleared', ({conversationId}) => { clearCache(conversationId).catch(() => {}); });
    s.on('message_vanished', ({conversationId, msgId}) => { removeFromCache(conversationId, msgId).catch(() => {}); });
    s.on('message_delivered', (payload) => {
      deliveredListeners.current.forEach(fn => fn(payload));
    });
    ['new_moment', 'moment_liked', 'moment_commented'].forEach((ev) => {
      s.on(ev, (payload) => {
        try { window.dispatchEvent(new CustomEvent('touliao:moment', { detail: { type: ev, payload } })); } catch { /* ignore */ }
      });
    });

    const onVisible = () => { if (document.visibilityState === 'visible' && !s.connected) s.connect(); };
    const onOnline  = () => { if (!s.connected) s.connect(); };
    // 断网立即断开：否则要等心跳超时（最长约 45 秒）才判定断线，期间界面无任何提示、发出的消息卡住
    const onOffline = () => { if (s.connected) s.disconnect(); };
    // Electron 专属：主进程 powerMonitor 监听到系统休眠唤醒后转发的事件（见 preload.js）。
    // 没有它的话，休眠唤醒后要等 socket.io pingTimeout(20秒) 超时才会判定断线开始重连；
    // 唤醒瞬间主动重连能把这个滞后降到几乎瞬间（AUDIT.md 十二节🟡）。
    // 2026-10：无条件 disconnect()+connect()——休眠后底层 TCP 往往已死但 s.connected 仍为
    // true（心跳尚未超时），旧写法 `if (!s.connected)` 恰好跳过重连。重连后通话侧由 'connect'
    // 回调发 resume 并重发在途 offer（四端统一重协商协议）。
    const onElectronResume = () => { s.disconnect(); s.connect(); };
    const onCredentialsUpdated = () => {
      const token = isBearerClient() ? localStorage.getItem('touliao_electron_token') : null;
      s.auth = { platform: isDesktop ? 'desktop' : 'web', isolated: isIsolatedWindow(), ...(token ? { token } : {}) };
      s.disconnect();
      s.connect();
    };
    const onStorage = event => { if (!isIsolatedWindow() && event.key === 'touliao_session_revision') onCredentialsUpdated(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('electron:resume', onElectronResume);
    window.addEventListener('touliao:credentials-updated', onCredentialsUpdated);
    window.addEventListener('storage', onStorage);

    return () => {
      everConnectedRef.current = false;
      disconnectAtRef.current = 0;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('electron:resume', onElectronResume);
      window.removeEventListener('touliao:credentials-updated', onCredentialsUpdated);
      window.removeEventListener('storage', onStorage);
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [userId]);

  // coreValue 只在 socket 对象更换时变（登录/登出），不在重连时变
  const coreValue = useMemo(() => ({
    socket,
    disconnectAtRef,
    registerUnreadCleared,
    registerDelivered,
  }), [socket, registerUnreadCleared, registerDelivered]);

  // statusValue 在 connect/disconnect/reconnect 时变
  const statusValue = useMemo(() => ({ connected, reconnectCount }), [connected, reconnectCount]);

  return (
    <SocketCoreContext.Provider value={coreValue}>
      <SocketStatusContext.Provider value={statusValue}>
        {children}
      </SocketStatusContext.Provider>
    </SocketCoreContext.Provider>
  );
};

/** 完整 context（向后兼容，现有消费方无需修改） */
export const useSocket = () => ({ ...useContext(SocketCoreContext), ...useContext(SocketStatusContext) });
/** 仅稳定部分 — socket/回调，重连时不触发 re-render */
export const useSocketCore   = () => useContext(SocketCoreContext);
/** 仅状态部分 — connected/reconnectCount */
export const useSocketStatus = () => useContext(SocketStatusContext);
