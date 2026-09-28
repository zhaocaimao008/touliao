import { isSessionCurrent } from './sessionContext';
import { upsertOutbox, removeFromOutbox } from './outbox';

// Used by both the composer and retry scheduling. Never buffer text on a Socket
// which may next connect with another account's cookies/credentials.
export function sendOwnedText({ socket, scope, message, isActive = () => true, onStatus, onAck, onRateLimited, onRejected }) {
  const current = () => isSessionCurrent(scope) && isActive();
  if (!current() || message.sender_id !== scope.accountId) return;
  const id = message._tempId || message.id;
  const fail = () => {
    if (!current()) return;
    upsertOutbox(message.conversation_id, message, scope);
    onStatus('error');
  };
  if (!socket?.connected) { fail(); return; }
  onStatus('sending');
  const timer = setTimeout(fail, 5000);
  socket.emit('send_message', {
    conversationId: message.conversation_id, content: message.content,
    type: message.type, reply_to_id: message.reply_to_id || null, clientMsgId: id,
  }, ack => {
    clearTimeout(timer);
    if (!current()) return;
    if (ack?.success && ack.message && ack.message.sender_id === scope.accountId &&
        ack.message.conversation_id === message.conversation_id) {
      removeFromOutbox(message.conversation_id, id, scope);
      onAck(ack.message);
    } else if (ack?.code === 'RATE_LIMITED' && onRateLimited?.(ack.retryAfterMs)) {
      // 调用方接管了退避重发调度：保持"发送中"，不落 outbox、不判失败。
    } else if (ack && ack.success === false && ack.error && onRejected) {
      // 服务端明确拒收（拉黑 / 已删除好友 / 屏蔽陌生人 / 禁言…）：重发也不会成功，不进 outbox，
      // 标失败并把原因告诉用户（原先只显示「发送失败」且进队列反复重试）
      removeFromOutbox(message.conversation_id, id, scope);
      onStatus('error');
      onRejected(ack.error);
    } else fail();
  });
  return timer;
}
