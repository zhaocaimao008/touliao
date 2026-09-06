export function splitArchivedConversations(conversations) {
  const active = [];
  const archived = [];
  for (const conversation of Array.isArray(conversations) ? conversations : []) {
    (conversation.archived ? archived : active).push(conversation);
  }
  return { active, archived };
}

export function archiveUnreadTotal(conversations, liveUnread = {}) {
  return (Array.isArray(conversations) ? conversations : []).reduce((sum, conversation) => {
    const value = Object.prototype.hasOwnProperty.call(liveUnread, conversation.id)
      ? liveUnread[conversation.id]
      : conversation.unreadCount;
    return sum + Math.max(0, Number(value) || 0);
  }, 0);
}
