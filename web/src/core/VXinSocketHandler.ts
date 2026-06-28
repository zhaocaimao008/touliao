/**
 * VXinSocketHandler.ts
 * v信 Socket 生命周期管理器 — 桌面端网络瞬断 / 休眠唤醒 / 重连安全
 *
 * Windows 桌面端独有挑战：
 *   1. 系统休眠（Sleep）→ 网络断开 → Socket disconnect
 *   2. 网线拔插 / WiFi 切换 → 瞬断
 *   3. 多网卡切换（以太网→WiFi）→ IP 变更 → 旧连接失效
 *   4. 重连成功后旧 Call ID 不得带入
 *
 * 架构：
 *   - 监听 Electron powerMonitor（`electronAPI.onSleep` / `onResume`）做状态重置
 *   - 监听 `navigator.onLine`（HTML5 API）做网络状态判断
 *   - 监听 Socket.io 原生 `disconnect` / `reconnect` 事件做重连安全清理
 *
 * ⚠️ 线程安全：
 *   所有事件在主线程 EventLoop 中串行触发，无需显式锁。
 *   state 字段在 disconnect→reconnect 窗口内可能被多次写入，
 *   但每次都是完整替换（无竞态），read-modify-write 不跨异步边界。
 */
import { ManagerOptions, Socket, SocketOptions, io } from 'socket.io-client';
import { VXinCallManager } from './VXinCallManager';
import { VXinMessageSender } from './VXinMessageSender';

// ── 配置常量 ──────────────────────────────────────────────

/** 重连最大延迟（指数退避上限） */
const RECONNECT_MAX_DELAY_MS = 30_000;

/** 探测心跳间隔（秒）：服务端无默认 ping 时，客户端主动心跳 */
const HEARTBEAT_INTERVAL_MS = 25_000;

/** 心跳超时（秒）：超过此时间未收到 pong 视为断线 */
const HEARTBEAT_TIMEOUT_MS = 10_000;

// ── 连接状态 ──────────────────────────────────────────────

export enum VXinConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  /** 网络不可用（navigator.onLine === false） */
  OFFLINE = 'offline',
}

export interface VXinSocketHandlers {
  onStateChange: (state: VXinConnectionState) => void;
  /** 重连成功时触发（前端可在此重新拉取会话列表 / 用户信息） */
  onReconnected: () => void;
  /** 收到服务端主动踢出（账号在其他设备登录等） */
  onKicked: (reason: string) => void;
}

// ── Socket 生命周期管理器（单例）───────────────────────────

export class VXinSocketHandler {
  private static _instance: VXinSocketHandler | null = null;

  private _socket: Socket | null = null;
  private _handlers: VXinSocketHandlers | null = null;

  /** 当前连接状态 */
  private _state: VXinConnectionState = VXinConnectionState.DISCONNECTED;

  /** 主动关闭标志：true 表示是用户主动登出 / 关闭窗口，此时不触发重连 */
  private _intentionalDisconnect = false;

  /** 是否已监听 Electron powerMonitor 事件 */
  private _powerMonitorAttached = false;

  /** 心跳轮询 timer */
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _lastPong = 0;

  private constructor() {}

  static getInstance(): VXinSocketHandler {
    if (!VXinSocketHandler._instance) {
      VXinSocketHandler._instance = new VXinSocketHandler();
    }
    return VXinSocketHandler._instance;
  }

  /**
   * 连接到服务端
   *
   * @param serverUrl  服务端地址（如 https://dipsin.com）
   * @param token      JWT token
   * @param handlers   状态变更回调
   */
  connect(serverUrl: string, token: string, handlers: VXinSocketHandlers): Socket {
    this._handlers = handlers;
    this._intentionalDisconnect = false;

    const wsUrl = serverUrl.replace(/^http/, 'ws');

    const options: Partial<ManagerOptions & SocketOptions> = {
      transports: ['websocket'],                // 与服务端 server.js 一致
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,           // 桌面端持续重连
      reconnectionDelay: 1_000,
      reconnectionDelayMax: RECONNECT_MAX_DELAY_MS,
      randomizationFactor: 0.3,
      timeout: 20_000,
    };

    this._socket = io(wsUrl, options);
    this._registerEvents();

    // 如果 Electron powerMonitor 可用，监听电源事件
    this._attachPowerMonitor();

    this._transitionTo(VXinConnectionState.CONNECTING);
    return this._socket;
  }

  /**
   * 主动断开（用户登出 / 关闭窗口），不触发重连
   */
  disconnect(): void {
    this._intentionalDisconnect = true;
    this._detachPowerMonitor();
    this._stopHeartbeat();
    this._socket?.disconnect();
    this._socket?.removeAllListeners();
    this._socket = null;
    this._transitionTo(VXinConnectionState.DISCONNECTED);
  }

  /** 获取底层 Socket 实例（用于 VXinMessageSender / VXinCallManager 绑定） */
  getSocket(): Socket | null {
    return this._socket;
  }

  /** 获取当前连接状态 */
  getState(): VXinConnectionState {
    return this._state;
  }

  // ── 事件注册 ──────────────────────────────────────────

  private _registerEvents(): void {
    if (!this._socket) return;

    this._socket.on('connect', () => {
      this._transitionTo(VXinConnectionState.CONNECTED);
      this._startHeartbeat();
    });

    this._socket.on('disconnect', (reason: string) => {
      // 主动断开不触发重连，也不进行状态清理
      if (this._intentionalDisconnect) return;

      this._stopHeartbeat();

      // 判断是否为网络原因（非主动、非 io 客户端关闭）
      const isNetworkIssue =
        reason === 'transport close' ||
        reason === 'transport error' ||
        reason === 'ping timeout' ||
        reason === 'io server disconnect';

      if (isNetworkIssue) {
        this._transitionTo(VXinConnectionState.RECONNECTING);

        // ⚠️ 关键安全点：网络断开时立即重置通话状态机
        //   防止重连后带入旧的 Call ID 继续发应答
        VXinCallManager.getInstance().onNetworkDisconnected();

        // 消息发送队列保持（重连后自动重试）
        // 但消息的 clientMsgId 已在 VXinMessageSender 中冻结，重入安全
      } else {
        // io client disconnect / 其他 → 不重连
        this._transitionTo(VXinConnectionState.DISCONNECTED);
      }
    });

    this._socket.on('connect_error', (err: Error) => {
      this._transitionTo(VXinConnectionState.RECONNECTING);
      console.warn('[VXinSocket] connect_error:', err.message);
    });

    this._socket.on('reconnect', (attempt: number) => {
      this._transitionTo(VXinConnectionState.CONNECTED);
      this._startHeartbeat();

      /**
       * ⚠️ 安全兜底：重连成功后触发上层恢复
       *   - 通知 VXinCallManager：但已在 disconnect 时重置，此处不再重复操作
       *   - 通知 UI 层重新拉取会话列表、用户在线状态
       *   - VXinMessageSender 的重试队列在重连后自动尝试发送（因为 socket 变为 connected）
       */
      this._handlers?.onReconnected();
    });

    this._socket.on('reconnect_error', () => {
      this._transitionTo(VXinConnectionState.RECONNECTING);
    });

    this._socket.on('reconnect_failed', () => {
      this._transitionTo(VXinConnectionState.DISCONNECTED);
    });

    // 账号在其他设备登录 / 被封禁 → 服务端主动踢出
    this._socket.on('kicked', (reason: string) => {
      this._intentionalDisconnect = true;
      this._socket?.disconnect();
      this._handlers?.onKicked(reason);
    });
  }

  // ── 心跳检测 ──────────────────────────────────────────

  /**
   * Socket.io 内置 ping/pong，但桌面端断网后 socket.io 可能延迟感知。
   * 额外主动心跳做快速故障检测。
   */
  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this._lastPong = Date.now();

    this._heartbeatTimer = setInterval(() => {
      if (!this._socket?.connected) {
        this._stopHeartbeat();
        return;
      }

      // 如果超过 HEARTBEAT_TIMEOUT 未收到 pong，视为断线
      if (Date.now() - this._lastPong > HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS) {
        console.warn('[VXinSocket] 心跳超时，强制断开');
        this._socket?.disconnect();
        return;
      }
    }, HEARTBEAT_INTERVAL_MS);

    // 监听 socket.io 内部 pong
    this._socket?.on('pong', () => {
      this._lastPong = Date.now();
    });
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ── Electron powerMonitor 集成 ─────────────────────────

  /**
   * 绑定 Electron powerMonitor 的 sleep/resume 事件。
   *
   * 实现方式：
   *   主进程 main.js 通过 IPC 推送 'power:sleep' / 'power:resume' 事件，
   *   preload.js 桥接为 DOM CustomEvent，我们在此监听。
   *
   * 如果运行在浏览器（非 Electron），这些事件永远不会触发，安全降级。
   */
  private _attachPowerMonitor(): void {
    if (this._powerMonitorAttached) return;
    this._powerMonitorAttached = true;

    // 监听 Electron preload 桥接的 powerMonitor 事件
    window.addEventListener('electron:power-sleep', () => {
      console.warn('[VXinSocket] 系统休眠');
      // 系统休眠前：主动断开 Socket（避免唤醒后的重复重连风暴）
      // 注意：不设 _intentionalDisconnect=true，因为唤醒后仍需重连
      if (this._socket?.connected) {
        this._socket.disconnect();
      }
      VXinCallManager.getInstance().onNetworkDisconnected();
    });

    window.addEventListener('electron:power-resume', () => {
      console.warn('[VXinSocket] 系统唤醒');
      // Socket.io 的 reconnection 机制会自动重连，无需额外操作
      // 但如果 socket 已经因为断开被清除了状态，需要手动重新连接
      if (!this._socket?.connected && !this._intentionalDisconnect) {
        this._socket?.connect();
      }
    });

    // 监听 HTML5 网络状态变化（适用于非 Electron 环境降级）
    window.addEventListener('offline', () => {
      this._transitionTo(VXinConnectionState.OFFLINE);
      VXinCallManager.getInstance().onNetworkDisconnected();
    });

    window.addEventListener('online', () => {
      if (this._state === VXinConnectionState.OFFLINE) {
        this._transitionTo(VXinConnectionState.CONNECTING);
        if (!this._socket?.connected && !this._intentionalDisconnect) {
          this._socket?.connect();
        }
      }
    });
  }

  private _detachPowerMonitor(): void {
    this._powerMonitorAttached = false;
    // 不移除 window 事件监听（避免多实例问题），但状态机 IDLE 后不会误触发
  }

  // ── 内部状态切换 ──────────────────────────────────────

  private _transitionTo(newState: VXinConnectionState): void {
    if (this._state === newState) return;
    this._state = newState;
    this._handlers?.onStateChange(newState);
  }
}
