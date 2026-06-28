/**
 * VXinAppInit.ts
 * v信 桌面客户端初始化示例 —— 串联所有核心管理器
 *
 * 在 React 根组件或 App 入口中调用一次。
 */
import { io } from 'socket.io-client';
import { VXinSocketHandler, VXinConnectionState } from './VXinSocketHandler';
import { VXinMessageSender } from './VXinMessageSender';
import { VXinCallManager, VXinCallState } from './VXinCallManager';

export class VXinAppInit {
  private _socketHandler = VXinSocketHandler.getInstance();
  private _msgSender = VXinMessageSender.getInstance();
  private _callManager = VXinCallManager.getInstance();

  /**
   * 登录成功后调用
   * @param serverUrl 服务端地址（如 https://dipsin.com）
   * @param token     JWT token
   */
  start(serverUrl: string, token: string): void {
    // 1. 建立 Socket 连接（管理器自动绑定所有事件）
    const socket = this._socketHandler.connect(serverUrl, token, {
      onStateChange: (state: VXinConnectionState) => {
        // 通知 UI 更新连接状态指示器
        console.log('[VXin] 连接状态:', state);
      },
      onReconnected: () => {
        // 重连成功：刷新会话列表、用户在线状态
        console.log('[VXin] 重连成功，刷新数据');
      },
      onKicked: (reason: string) => {
        // 账号被踢：强制登出
        console.error('[VXin] 账号被踢:', reason);
      },
    });

    // 2. 初始化消息发送引擎（绑定 socket + 状态变更回调）
    this._msgSender.init(socket, (msg) => {
      // 消息发送状态变更（pending → sent → delivered / failed）
      console.log('[VXin] 消息状态:', msg.status, msg.id);
    });

    // 3. 初始化通话管理器
    this._callManager.init(socket, {
      onStateChange: (state: VXinCallState, detail) => {
        // 通话状态变更 → 更新 UI（显示/隐藏通话窗口）
        console.log('[VXin] 通话状态:', state, detail);
      },
      onTimeout: () => {
        // 对方无应答 → 弹窗提示
        alert('对方无应答');
      },
      onRemoteEnded: () => {
        // 对方挂断 → 关闭通话窗口
        console.log('[VXin] 对方已挂断');
      },
      onError: (error: string) => {
        console.error('[VXin] 通话错误:', error);
      },
    });
  }

  /** 登出时调用 */
  stop(): void {
    this._callManager.reset();
    this._msgSender.reset();
    this._socketHandler.disconnect();
  }

  /** 发送文本消息示例（自动幂等性） */
  sendTextMessage(conversationId: string, content: string): void {
    // 首次创建时自动生成 clientMsgId（UUIDv4）
    // 内部 retry 全程复用此 ID，服务端唯一索引去重
    this._msgSender.sendMessage(conversationId, 'text', content);
  }

  /** 发起通话示例（自动 115s 本地超时） */
  startCall(conversationId: string, peerId: string, peerName: string): void {
    this._callManager.startCall(conversationId, 'audio', peerId, peerName);
  }
}
