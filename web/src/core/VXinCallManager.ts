/**
 * VXinCallManager.ts
 * v信 音视频通话管理器 — 本地超时倒计时 + 状态机清理
 *
 * 服务端约定：
 *   - CALL_TIMEOUT_MS = 120_000ms（120 秒）：未被应答的通话由服务端自动销毁
 *   - 断线时服务端自动清理该用户全部 activeCalls，已接通的转为 completed
 *
 * 客户端本地策略（预留 5 秒时钟差异）：
 *   - 本地超时 = 115_000ms（115 秒）：到期弹窗"对方无应答"
 *   - 已接听 / 主动挂断时立即 cancel 定时器
 *   - 断线 / 系统休眠时彻底重置通话状态机
 *
 * 状态机：
 *   IDLE → CALLING（本地超时倒计时开始）→ IN_CALL（已接听，定时器取消）
 *        → CANCELLED / REJECTED / TIMEOUT → IDLE
 *   IDLE → INCOMING（收到来电）→ 用户操作
 *
 * ⚠️ 线程安全：
 *   所有状态变更通过单一入口 transitionTo() 完成，
 *   setTimeout 定时器 handle 由类字段持有，不存在并发竞争。
 */
import { Socket } from 'socket.io-client';

// ── 配置常量 ──────────────────────────────────────────────

/** 本地超时（毫秒）：服务端 120s，本地预留 5s 时钟差异 */
const LOCAL_CALL_TIMEOUT_MS = 115_000;

/** 通话状态枚举 */
export enum VXinCallState {
  IDLE = 'idle',
  CALLING = 'calling',       // 主叫方：已发出请求，等待被叫应答
  INCOMING = 'incoming',     // 被叫方：收到来电，等待用户操作
  IN_CALL = 'in_call',       // 通话中（已接通）
  CANCELLED = 'cancelled',   // 主叫方主动取消
  REJECTED = 'rejected',     // 被叫方拒绝
  TIMEOUT = 'timeout',       // 等待应答超时
  ENDED = 'ended',           // 通话结束
}

/** 通话类型 */
export type VXinCallType = 'audio' | 'video';

/** 通话状态变更回调 */
export interface VXinCallEventHandlers {
  onStateChange: (state: VXinCallState, detail?: Record<string, unknown>) => void;
  onTimeout: () => void;                    // 对方无应答
  onRemoteEnded: () => void;                // 对方挂断
  onError: (error: string) => void;
}

// ── 通话管理器（单例）──────────────────────────────────────

export class VXinCallManager {
  private static _instance: VXinCallManager | null = null;

  private _socket: Socket | null = null;
  private _handlers: VXinCallEventHandlers | null = null;

  /** 当前通话状态 */
  private _state: VXinCallState = VXinCallState.IDLE;
  /** 本地超时定时器 handle */
  private _localTimer: ReturnType<typeof setTimeout> | null = null;
  /** 当前通话信息 */
  private _currentCall: {
    callId?: string;        // 服务端记录的 call_logs id（仅 activeCall）
    conversationId: string;
    type: VXinCallType;
    peerId: string;
    peerName: string;
  } | null = null;

  private constructor() {}

  static getInstance(): VXinCallManager {
    if (!VXinCallManager._instance) {
      VXinCallManager._instance = new VXinCallManager();
    }
    return VXinCallManager._instance;
  }

  /** 初始化 Socket 绑定 */
  init(socket: Socket, handlers: VXinCallEventHandlers): void {
    this._socket = socket;
    this._handlers = handlers;
    this._registerSocketEvents();
  }

  /** 彻底重置（断线 / 登出时调用，清空所有状态和定时器） */
  reset(): void {
    this._cancelLocalTimer();
    this._state = VXinCallState.IDLE;
    this._currentCall = null;
  }

  // ── 对外操作接口 ──────────────────────────────────────

  /** 发起通话（主叫方） */
  startCall(conversationId: string, type: VXinCallType, peerId: string, peerName: string): void {
    if (this._state !== VXinCallState.IDLE) {
      this._handlers?.onError('当前已有进行中的通话');
      return;
    }

    this._currentCall = { conversationId, type, peerId, peerName };
    this._transitionTo(VXinCallState.CALLING);

    // 开启本地 115s 超时倒计时
    this._startLocalTimeout();

    // 发送服务端呼叫请求
    this._socket?.emit('call:request', {
      to: peerId,
      type,
      caller: { id: '', username: peerName },
    });
  }

  /** 接听通话（被叫方） */
  acceptCall(): void {
    if (this._state !== VXinCallState.INCOMING || !this._currentCall) return;

    // 取消来电响铃定时器（来电提示音也应在此时停止）
    this._cancelLocalTimer();

    this._socket?.emit('call:response', {
      to: this._currentCall.peerId,
      accepted: true,
    });

    this._transitionTo(VXinCallState.IN_CALL);
  }

  /** 拒绝通话（被叫方） */
  rejectCall(): void {
    if (this._state !== VXinCallState.INCOMING || !this._currentCall) return;

    this._cancelLocalTimer();

    this._socket?.emit('call:response', {
      to: this._currentCall.peerId,
      accepted: false,
    });

    this._transitionTo(VXinCallState.REJECTED);
    this._resetToIdle();
  }

  /** 挂断通话（双方均可调用） */
  endCall(): void {
    if (this._state === VXinCallState.IDLE) return;

    this._cancelLocalTimer();

    if (this._currentCall) {
      this._socket?.emit('call:end', { to: this._currentCall.peerId });
    }

    this._transitionTo(VXinCallState.ENDED);
    this._resetToIdle();
  }

  /** 获取当前状态 */
  getState(): VXinCallState {
    return this._state;
  }

  /** 获取当前通话信息 */
  getCurrentCall(): Readonly<typeof this._currentCall> {
    return this._currentCall as Readonly<typeof this._currentCall>;
  }

  // ── 断线安全重置 ──────────────────────────────────────

  /**
   * 网络断开时调用（由 VXinSocketHandler 触发）
   *
   * 安全兜底：
   *   - 通话中断线 → 彻底清空状态机
   *   - 重连后禁止带入旧的 Call ID
   *   - 用户须手动重新发起通话
   */
  onNetworkDisconnected(): void {
    if (this._state === VXinCallState.IDLE) return;

    const wasInCall = this._state === VXinCallState.IN_CALL;
    this._cancelLocalTimer();
    this._state = VXinCallState.IDLE;
    this._currentCall = null;

    if (wasInCall) {
      this._handlers?.onError('网络已断开，通话已结束');
    }
  }

  // ── Socket 事件绑定 ───────────────────────────────────

  private _registerSocketEvents(): void {
    if (!this._socket) return;

    this._socket.on('call:incoming', (data: { from: string; type: string; caller?: { id: string; username: string } }) => {
      if (this._state !== VXinCallState.IDLE) {
        // 忙线：服务端的防骚扰检查会拒接，但本地也应防御
        return;
      }

      this._currentCall = {
        conversationId: '', // 私聊会话由前端根据 from 查找
        type: (data.type === 'video' ? 'video' : 'audio') as VXinCallType,
        peerId: data.from,
        peerName: data.caller?.username ?? '',
      };

      // 被叫方也有一个本地超时，避免来电窗口一直挂着
      this._startLocalTimeout();
      this._transitionTo(VXinCallState.INCOMING, { from: data.from, caller: data.caller });
    });

    this._socket.on('call:response', (data: { from: string; accepted: boolean }) => {
      if (this._state !== VXinCallState.CALLING) return;
      if (data.from !== this._currentCall?.peerId) return;

      this._cancelLocalTimer();

      if (data.accepted) {
        this._transitionTo(VXinCallState.IN_CALL);
      } else {
        this._transitionTo(VXinCallState.REJECTED);
        this._resetToIdle();
      }
    });

    this._socket.on('call:end', (data: { from: string }) => {
      if (this._state === VXinCallState.IDLE) return;
      if (data.from !== this._currentCall?.peerId) return;

      this._cancelLocalTimer();
      this._transitionTo(VXinCallState.ENDED);
      this._handlers?.onRemoteEnded();
      this._resetToIdle();
    });
  }

  // ── 超时管理 ──────────────────────────────────────────

  /** 启动本地超时倒计时（115 秒） */
  private _startLocalTimeout(): void {
    this._cancelLocalTimer();
    this._localTimer = setTimeout(() => {
      this._onLocalTimeout();
    }, LOCAL_CALL_TIMEOUT_MS);
  }

  /** 取消本地超时倒计时 */
  private _cancelLocalTimer(): void {
    if (this._localTimer !== null) {
      clearTimeout(this._localTimer);
      this._localTimer = null;
    }
  }

  /** 本地超时回调：服务端 120s 到期前 5 秒触发 */
  private _onLocalTimeout(): void {
    this._localTimer = null;

    if (this._state === VXinCallState.CALLING) {
      // 主叫方：对方无应答
      this._transitionTo(VXinCallState.TIMEOUT);

      // 通知服务端取消（可选：服务端 120s 超时也会自动清理，但主动通知更快）
      if (this._currentCall) {
        this._socket?.emit('call:end', { to: this._currentCall.peerId });
      }

      this._handlers?.onTimeout();
      this._resetToIdle();
    } else if (this._state === VXinCallState.INCOMING) {
      // 被叫方：来电超时，自动关闭来电窗口
      this._transitionTo(VXinCallState.TIMEOUT);
      this._resetToIdle();
    }
  }

  // ── 状态机核心 ──────────────────────────────────────────

  /**
   * 状态切换（仅在主线程事件循环中调用，无并发问题）
   */
  private _transitionTo(newState: VXinCallState, detail?: Record<string, unknown>): void {
    const oldState = this._state;
    this._state = newState;
    this._handlers?.onStateChange(newState, { oldState, ...detail });
  }

  /** 安全重置到 IDLE（延迟一帧，避免在事件回调中触发的递归状态变更） */
  private _resetToIdle(): void {
    // 使用微任务延时确保当前事件处理完成后才清理
    queueMicrotask(() => {
      this._cancelLocalTimer();
      this._state = VXinCallState.IDLE;
      this._currentCall = null;
      this._handlers?.onStateChange(VXinCallState.IDLE, { oldState: this._state });
    });
  }
}
