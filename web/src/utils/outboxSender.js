import { isSessionCurrent } from './sessionContext';
import { upsertOutbox, removeFromOutbox } from './outbox';

// Used by both the composer and retry scheduling. Never buffer text on a Socket
// which may next connect with another account's cookies/credentials.
export function sendOwnedText({ socket, scope, message, isActive = () => true, onStatus, onAck }) {
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
    } else fail();
  });
  return timer;
}
