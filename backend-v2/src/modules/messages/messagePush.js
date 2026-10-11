'use strict';
/**
 * 非 socket 消息创建路径的离线推送入口（2026-10-11）。
 *
 * 背景：HTTP 发送/合并转发、逐条转发、表情、分片上传、直传文件、红包、转账这些路径此前
 * 只做了「落库 + 广播」，从不调 pushNewMessage——收件人 App 在后台/被杀（socket 已断）时
 * 收不到任何 FCM/个推/APNs/Web Push 通知，只能等下次打开 App 才看到。客户端里这些都是
 * 主流程而非罕见兜底：Web ForwardModal 合并转发走 POST /api/messages/:cid、普通转发走
 * /api/messages/forward，Web ChatWindow 大文件走 upload-init/upload-finish，Android
 * StickerApi/ChunkUploader/MessageApi 分别调表情发送、分片 finish、转发接口。
 *
 * 载荷字段与 realtime/handlers/message.js、file.js 的 pushNewMessage 调用保持一致。
 * 刻意不挂在 appendConversationEvent 这个公共写入口上：socket handler 有自己的送达回执/
 * @提及/推送逻辑，挂在公共入口会让 socket 消息推两次。调用方只在「新落库」分支调用，
 * clientMsgId 去重 / 并发撞唯一约束回放 / 金融幂等回放都不能再推。
 */
const push = require('../../utils/push');
const presence = require('../../realtime/presence');

/**
 * 广播之后调度一次离线推送。
 * @param msg     已落库并装配好的消息行（需含 id/conversation_id/sender_id/type/created_at/senderName/burn_after）
 * @param content 推送正文用的内容（文件名、表情占位等；阅后即焚消息一律替换为占位文案，不外泄原文）
 */
function schedulePushNewMessage(msg, content) {
  if (!msg) return;
  // setImmediate：pushNewMessage 内有逐收件人未读数/角标等同步 better-sqlite3 查询，
  // 与 socket 路径一样挪出当前 tick，不拖慢 HTTP 响应；推送失败只丢通知，不影响已落库消息。
  setImmediate(() => {
    try {
      push.pushNewMessage({
        messageId: msg.id,
        conversationId: msg.conversation_id, senderId: msg.sender_id, senderName: msg.senderName,
        content: msg.burn_after ? '[阅后即焚消息]' : content, type: msg.type,
        timestamp: msg.created_at, onlineUserIds: presence.onlineUserIdSet(),
      }).catch(() => {});
    } catch (err) {
      console.error('[push] 消息推送调度失败:', err.message);
    }
  });
}

module.exports = { schedulePushNewMessage };
