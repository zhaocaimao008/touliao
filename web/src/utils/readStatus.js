const READ_DETAIL_TYPES = new Set(['text', 'image', 'file']);

export function canViewReadStatus(message, currentUserId) {
  if (!message || message.deleted || message._tempId || !message.id) return false;
  return String(message.sender_id) === String(currentUserId)
    && READ_DETAIL_TYPES.has(message.type);
}

export function readUserIdsForMessage(payload, messageId) {
  const raw = payload?.readStates?.[messageId];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(id => id !== null && id !== undefined).map(String))];
}

function memberId(member) {
  return String(member?.id ?? member?.user_id ?? '');
}

function memberName(member) {
  return member?.remark || member?.username || member?.name || '';
}

export function createReadStatusModel({
  conversation,
  members = [],
  currentUserId,
  message,
  readUserIds = [],
}) {
  const senderId = String(message?.sender_id ?? currentUserId ?? '');
  const readIds = [...new Set(readUserIds.map(String))].filter(id => id && id !== senderId);

  if (conversation?.type !== 'group') {
    const peer = conversation?.otherUser
      || members.find(member => memberId(member) && memberId(member) !== String(currentUserId));
    const peerId = memberId(peer);
    return {
      type: 'private',
      isRead: peerId ? readIds.includes(peerId) : readIds.length > 0,
      peerName: memberName(peer),
    };
  }

  const byId = new Map(members.map(member => [memberId(member), member]));
  const recipients = members.filter(member => memberId(member) && memberId(member) !== senderId);
  const readers = readIds.map(id => {
    const member = byId.get(id);
    return { id, name: memberName(member), avatar: member?.avatar || '' };
  });

  return {
    type: 'group',
    readCount: readers.length,
    recipientCount: recipients.length,
    readers,
  };
}
