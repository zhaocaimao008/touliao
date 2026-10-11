'use strict';

// Shared wire contract with Android NotificationPolicy; never use sender names
// as notification identity (same names and account switches must stay isolated).
function notificationTag(recipientId, conversationId) {
  return `touliao:${recipientId}:${conversationId || 'global'}`;
}
function notificationId(recipientId, conversationId) {
  let hash = 0;
  const tag = notificationTag(recipientId, conversationId);
  for (let i = 0; i < tag.length; i++) hash = (Math.imul(31, hash) + tag.charCodeAt(i)) | 0;
  return 0x20000000 | (hash & 0x0fffffff);
}
function messageChannel(sound = true, vibrate = false) {
  return `touliao_messages_s${sound ? 1 : 0}_v${vibrate ? 1 : 0}`;
}
const CHAT_TYPES = new Set(['message', 'text', 'image', 'voice', 'video', 'file', 'location', 'sticker', 'red_packet', 'contact_card', 'merged']);
function messagePriority(type, quiet = false) {
  return !quiet && (CHAT_TYPES.has(type) || type === 'call' || type === 'payment') ? 'high' : 'normal';
}
module.exports = { notificationTag, notificationId, messageChannel, messagePriority };
