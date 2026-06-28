/**
 * VXinMessageModel.ts
 * v信 消息数据模型 — 写时不可变，发送前构建快照
 *
 * 约束：
 *   - 每条待发送消息在首次构建时生成 clientMsgId（UUIDv4），后续重试不得变更
 *   - 模型一旦 emit 发送后即为不可变快照，重试队列持有引用而非拷贝
 */
import { v4 as uuidv4 } from 'uuid';

/** 消息类型枚举 —— 与服务端 messages.type 一致 */
export type VXinMessageType =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'file'
  | 'location'
  | 'contact_card'
  | 'nudge'
  | 'red_packet';

/** 被回复的原始消息快照 */
export interface VXinReplyTo {
  id: string;
  type: VXinMessageType;
  content: string;
  file_url?: string;
  senderName: string;
}

/**
 * 消息发送载荷 —— 与服务端 send_message/send_file_message 契约对齐。
 *
 * ⚠️ 线程安全：
 *   TypeScript 单线程事件循环，无需显式锁。
 *   但 clientMsgId 在 async 重试中可能并发访问（连续两次 send 读到同一引用），
 *   使用 readonly class + 冻结对象防御。
 */
export class VXinMessageModel {
  /** 全局唯一 ID（服务端写入后赋值，发送前为空字符串） */
  public readonly id: string;
  /** 会话 ID */
  public readonly conversationId: string;
  /** 消息类型 */
  public readonly type: VXinMessageType;
  /** 文本内容 / JSON（contact_card/nudge） */
  public readonly content: string;
  /** 文件 URL（image/voice/video/file 类型必填） */
  public readonly fileUrl: string;
  /** 语音/视频时长（秒） */
  public readonly duration: number;
  /** 引用的消息 ID */
  public readonly replyToId: string | null;
  /** 引用的消息快照 */
  public readonly replyTo: VXinReplyTo | null;
  /** 客户端幂等键 — 首次生成，重试复用，发送后冻结 */
  public readonly clientMsgId: string;
  /** 发送时间戳（秒级 unix，服务端写入后赋值） */
  public readonly createdAt: number;
  /** 发送者显示名（服务端回显后赋值） */
  public readonly senderName: string;
  /** 发送者头像（服务端回显后赋值） */
  public readonly senderAvatar: string;

  /** 发送状态枚举 */
  public readonly status: VXinSendStatus;

  private constructor(builder: VXinMessageBuilder) {
    this.id = builder.id ?? '';
    this.conversationId = builder.conversationId;
    this.type = builder.type;
    this.content = builder.content ?? '';
    this.fileUrl = builder.fileUrl ?? '';
    this.duration = builder.duration ?? 0;
    this.replyToId = builder.replyToId ?? null;
    this.replyTo = builder.replyTo ?? null;
    this.clientMsgId = builder.clientMsgId ?? uuidv4(); // 首次自动生成
    this.createdAt = builder.createdAt ?? 0;
    this.senderName = builder.senderName ?? '';
    this.senderAvatar = builder.senderAvatar ?? '';
    this.status = builder.status ?? 'pending';

    // 冻结实例，防止重试过程中 clientMsgId 被意外覆盖
    Object.freeze(this);
  }

  /** 工厂方法：创建一条待发送的消息（首次构建时自动生成 clientMsgId） */
  static create(params: {
    conversationId: string;
    type: VXinMessageType;
    content?: string;
    fileUrl?: string;
    duration?: number;
    replyToId?: string | null;
    replyTo?: VXinReplyTo | null;
  }): VXinMessageModel {
    return new VXinMessageModel(params);
  }

  /** 从服务端 ACK 响应构建已确认模型（填充 id/createdAt/senderName/senderAvatar） */
  static fromServerAck(ack: {
    id: string;
    conversation_id: string;
    sender_id: string;
    type: VXinMessageType;
    content: string;
    file_url?: string;
    duration?: number;
    reply_to_id?: string | null;
    replyTo?: VXinReplyTo | null;
    created_at: number;
    senderName: string;
    senderAvatar: string;
    clientMsgId?: string;
  }): VXinMessageModel {
    return new VXinMessageModel({
      id: ack.id,
      conversationId: ack.conversation_id,
      type: ack.type,
      content: ack.content,
      fileUrl: ack.file_url ?? '',
      duration: ack.duration ?? 0,
      replyToId: ack.reply_to_id ?? null,
      replyTo: ack.replyTo ?? null,
      clientMsgId: ack.clientMsgId ?? '',
      createdAt: ack.created_at,
      senderName: ack.senderName,
      senderAvatar: ack.senderAvatar,
      status: ack.sender_id === 'local' ? 'sending' : 'sent',
    });
  }

  /** 更新发送状态（仅用于 sent → delivered / failed）返回新实例 */
  withStatus(status: VXinSendStatus): VXinMessageModel {
    return VXinMessageModel.fromServerAck({
      id: this.id,
      conversation_id: this.conversationId,
      sender_id: '',
      type: this.type,
      content: this.content,
      file_url: this.fileUrl,
      reply_to_id: this.replyToId,
      replyTo: this.replyTo,
      created_at: this.createdAt,
      senderName: this.senderName,
      senderAvatar: this.senderAvatar,
    });
    // 通过冻结阻止修改，重试必须引用原始 clientMsgId
  }
}

/** 发送状态 */
export type VXinSendStatus =
  | 'pending'     // 用户已提交，尚未 emit
  | 'sending'     // 已 emit，等待服务端 ACK
  | 'sent'        // 收到服务端 ACK（success: true）
  | 'delivered'   // 服务端推送 delivery 回执
  | 'failed';     // 重试耗尽 / 服务端返回 error

/**
 * 内部构建器接口（符合 class 私有构造签名）
 * clientMsgId 省略时自动 uuidv4，开发者无需手动传参。
 */
type VXinMessageBuilder = {
  id?: string;
  conversationId: string;
  type: VXinMessageType;
  content?: string;
  fileUrl?: string;
  duration?: number;
  replyToId?: string | null;
  replyTo?: VXinReplyTo | null;
  clientMsgId?: string;
  createdAt?: number;
  senderName?: string;
  senderAvatar?: string;
  status?: VXinSendStatus;
};
