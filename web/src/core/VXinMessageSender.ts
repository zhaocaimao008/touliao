/**
 * VXinMessageSender.ts
 * v信 消息发送引擎 — 重试队列 + clientMsgId 幂等性保证
 *
 * 核心设计：
 *   1. 每条消息在首次 VXinMessageModel.create() 时生成 clientMsgId（UUIDv4）
 *   2. 重试时严格复用该 clientMsgId，绝不重新生成
 *   3. 服务端 (sender_id, client_msg_id) 唯一索引确保物理去重
 *   4. 重试间隔使用指数退避（Exponential Backoff），避免重连风暴
 *
 * ⚠️ 线程安全：
 *   - send() 内部使用 Promise 链，天然串行
 *   - retryQueue 是 async 串行的（一次只处理一条消息的多次重试）
 *   - 不涉及共享可变状态，无需显式锁
 */
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { VXinMessageModel, VXinMessageType, VXinSendStatus } from './VXinMessageModel';

// ── 配置常量 ──────────────────────────────────────────────

/** 最大重试次数（5 次 = 约 15 秒内完成所有退避重试） */
const MAX_RETRIES = 5;

/** 退避基数（秒）：第 1 次重试等待 1s，第 2 次 2s，第 3 次 4s … */
const BACKOFF_BASE_MS = 1_000;

/** ACK 超时（秒）：超过此时间未收到服务端 ack 视为失败 */
const ACK_TIMEOUT_MS = 15_000;

// ── 类型定义 ──────────────────────────────────────────────

/** 发送结果回调 */
export interface VXinSendResult {
  success: boolean;
  message?: VXinMessageModel;
  error?: string;
}

/** 内部重试条目 */
interface RetryEntry {
  model: VXinMessageModel;
  attempt: number;
  timerId?: ReturnType<typeof setTimeout>;
}

// ── 单例发送引擎 ──────────────────────────────────────────

export class VXinMessageSender {
  private static _instance: VXinMessageSender | null = null;

  private _socket: Socket | null = null;
  /** 重试队列：key = clientMsgId（全局唯一，一次只有一条消息在重试周期内） */
  private readonly _retryMap = new Map<string, RetryEntry>();
  /** 发送进度回调 */
  private _onStatusChange?: (msg: VXinMessageModel) => void;

  private constructor() {}

  /** 获取单例 */
  static getInstance(): VXinMessageSender {
    if (!VXinMessageSender._instance) {
      VXinMessageSender._instance = new VXinMessageSender();
    }
    return VXinMessageSender._instance;
  }

  /**
   * 初始化绑定 Socket 实例
   * 应在应用启动 / 登录成功后调用一次
   */
  init(socket: Socket, onStatusChange?: (msg: VXinMessageModel) => void): void {
    this._socket = socket;
    this._onStatusChange = onStatusChange;
  }

  /**
   * 重置（断线 / 登出时清空重试队列，防止过期重试污染新会话）
   */
  reset(): void {
    this.cancelAllRetries();
    this._socket = null;
  }

  // ── 对外发送接口 ──────────────────────────────────────

  /**
   * 发送文本 / 名片消息
   *
   * @param conversationId  会话 ID
   * @param type            消息类型（text | contact_card）
   * @param content         消息内容
   * @param replyToId       可选：回复的消息 ID
   * @returns               创建的消息模型（clientMsgId 已生成）
   */
  sendMessage(
    conversationId: string,
    type: 'text' | 'contact_card',
    content: string,
    replyToId?: string | null,
  ): VXinMessageModel {
    // 首次创建消息模型时自动生成 clientMsgId（幂等性的起点）
    const model = VXinMessageModel.create({
      conversationId,
      type,
      content,
      replyToId: replyToId ?? null,
    });

    this._doSend(model, 0);
    return model;
  }

  /**
   * 发送文件消息（image / voice / video / file）
   *
   * @param conversationId  会话 ID
   * @param type            文件类型
   * @param fileUrl         上传后的 URL
   * @param content         可选描述文字
   * @param duration        语音/视频时长
   * @param replyToId       可选回复 ID
   */
  sendFileMessage(
    conversationId: string,
    type: 'image' | 'voice' | 'video' | 'file',
    fileUrl: string,
    content?: string,
    duration?: number,
    replyToId?: string | null,
  ): VXinMessageModel {
    const model = VXinMessageModel.create({
      conversationId,
      type,
      content,
      fileUrl,
      duration,
      replyToId: replyToId ?? null,
    });

    this._doSendFile(model, 0);
    return model;
  }

  // ── 重试控制 ──────────────────────────────────────────

  /**
   * 手动取消某条消息的重试（用户主动撤回 / 离开页面时调用）
   */
  cancelRetry(clientMsgId: string): void {
    const entry = this._retryMap.get(clientMsgId);
    if (entry) {
      if (entry.timerId !== undefined) {
        clearTimeout(entry.timerId);
      }
      this._retryMap.delete(clientMsgId);
    }
  }

  /** 取消全部重试（断线 / 页面卸载时调用） */
  cancelAllRetries(): void {
    for (const [, entry] of this._retryMap) {
      if (entry.timerId !== undefined) {
        clearTimeout(entry.timerId);
      }
    }
    this._retryMap.clear();
  }

  // ── 内部发送逻辑 ──────────────────────────────────────

  /**
   * 核心发送函数（文本/名片）
   *
   * 幂等性要点：
   *   - 重试时 model.clientMsgId 与首次完全一致（model 是冻结对象，只读）
   *   - 服务端凭 (sender_id, client_msg_id) 唯一索引检测重复并返回已有消息
   *   - 因此第 2..N 次重试的 ACK 中包含的是最早那条消息的 id，不会产生重复行
   */
  private _doSend(model: VXinMessageModel, attempt: number): void {
    if (!this._socket?.connected) {
      // Socket 未连接 → 入重试队列等待重连后自动补充
      this._enqueueRetry(model, attempt);
      return;
    }

    this._emitWithAck(
      'send_message',
      {
        conversationId: model.conversationId,
        type: model.type,
        content: model.content,
        reply_to_id: model.replyToId,
        clientMsgId: model.clientMsgId, // ⚠️ 重试时沿用原始 clientMsgId，绝不重新生成
      },
      model,
      attempt,
    );
  }

  /**
   * 核心发送函数（文件/图片/语音/视频）
   */
  private _doSendFile(model: VXinMessageModel, attempt: number): void {
    if (!this._socket?.connected) {
      this._enqueueRetry(model, attempt);
      return;
    }

    this._emitWithAck(
      'send_file_message',
      {
        conversationId: model.conversationId,
        type: model.type,
        file_url: model.fileUrl,
        content: model.content,
        duration: model.duration,
        reply_to_id: model.replyToId,
        clientMsgId: model.clientMsgId, // ⚠️ 重试时沿用原始 clientMsgId
      },
      model,
      attempt,
    );
  }

  /**
   * Socket.io emit + ACK + 超时包装器
   *
   * 用 Promise.race 实现 ACK 超时：
   *   - 服务端在 writeAsync 落库后才回调 ack，超时意味着消息可能已入库但 ack 丢失
   *   - 此时重试携带 clientMsgId，服务端命中唯一索引返回已有消息，实现幂等
   */
  private _emitWithAck(
    event: string,
    payload: Record<string, unknown>,
    model: VXinMessageModel,
    attempt: number,
  ): void {
    if (!this._socket) return;

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('ACK_TIMEOUT')), ACK_TIMEOUT_MS),
    );

    const ack = new Promise<{ success: boolean; message?: Record<string, unknown>; error?: string }>(
      (resolve, reject) => {
        this._socket!.emit(event, payload, (response: unknown) => {
          if (response && typeof response === 'object' && 'success' in (response as object)) {
            resolve(response as { success: boolean; message?: Record<string, unknown>; error?: string });
          } else {
            reject(new Error('INVALID_ACK_FORMAT'));
          }
        });
      },
    );

    Promise.race([ack, timeout])
      .then((resp) => {
        if (resp.success) {
          // 发送成功：删除重试条目
          this._retryMap.delete(model.clientMsgId);
          // 通知上层状态变更
          if (resp.message) {
            const acked = VXinMessageModel.fromServerAck(resp.message as Record<string, unknown> as any);
            this._onStatusChange?.(acked);
          }
        } else {
          // 服务端返回了明确的错误（权限/限流/禁言等）→ 不重试
          this._retryMap.delete(model.clientMsgId);
          this._onStatusChange?.(model.withStatus('failed'));
        }
      })
      .catch((err: Error) => {
        if (err.message === 'ACK_TIMEOUT') {
          // ACK 超时 → 可能已落库但 ack 丢失 → 带 clientMsgId 重试（幂等安全）
          this._scheduleRetry(model, attempt + 1);
        } else {
          // 其他网络错误
          this._scheduleRetry(model, attempt + 1);
        }
      });
  }

  // ── 重试调度（指数退避）────────────────────────────────

  private _enqueueRetry(model: VXinMessageModel, attempt: number): void {
    // 如果已有一条相同 clientMsgId 的条目在队列中，不重复入队
    if (this._retryMap.has(model.clientMsgId)) return;
    this._scheduleRetry(model, attempt);
  }

  private _scheduleRetry(model: VXinMessageModel, attempt: number): void {
    if (attempt > MAX_RETRIES) {
      // 重试耗尽 → 标记失败
      this._retryMap.delete(model.clientMsgId);
      this._onStatusChange?.(model.withStatus('failed'));
      return;
    }

    // 指数退避：1s, 2s, 4s, 8s, 16s
    const delayMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 500;

    const timerId = setTimeout(() => {
      // 重试时 model.clientMsgId 是冻结的只读属性，与首次完全一致
      if (model.type === 'image' || model.type === 'voice' || model.type === 'video' || model.type === 'file') {
        this._doSendFile(model, attempt);
      } else {
        this._doSend(model, attempt);
      }
    }, delayMs);

    this._retryMap.set(model.clientMsgId, { model, attempt, timerId });
  }
}
