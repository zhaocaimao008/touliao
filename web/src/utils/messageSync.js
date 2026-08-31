export function applySyncEvents(currentMessages, events) {
  const byId = new Map((currentMessages || []).filter(Boolean).map(message => [String(message.id), message]));
  for (const event of [...(events || [])].sort((a, b) => a.server_sequence - b.server_sequence)) {
    const key = String(event.message_id);
    if (event.event_type === 'message_created') {
      if (!event.message) continue;
      const optimisticKey = event.message.client_msg_id;
      if (optimisticKey) {
        for (const [id, message] of byId) {
          if (message?._tempId === optimisticKey || id === String(optimisticKey)) byId.delete(id);
        }
      }
      byId.set(key, { ...(byId.get(key) || {}), ...event.message });
    } else if (event.event_type === 'message_edited') {
      const message = byId.get(key);
      if (message) byId.set(key, { ...message, content: event.payload?.content ?? message.content, edited: 1 });
    } else if (['message_recalled', 'message_deleted_for_me', 'message_vanished'].includes(event.event_type)) {
      byId.delete(key);
    }
  }
  return [...byId.values()].sort((a, b) =>
    (a.server_sequence || Number.MAX_SAFE_INTEGER) - (b.server_sequence || Number.MAX_SAFE_INTEGER) ||
    (a.created_at || 0) - (b.created_at || 0) || String(a.id).localeCompare(String(b.id))
  );
}

export async function catchUpConversation({ conversationId, accountId, requestPage, loadCursor, saveCursor, applyPage, limit = 500 }) {
  let cursor = await loadCursor(accountId, conversationId);
  let hasMore = true;
  while (hasMore) {
    const page = await requestPage(conversationId, cursor, limit);
    if (!page || !Number.isSafeInteger(page.next_cursor) || page.next_cursor < cursor) throw new Error('invalid sync cursor response');
    await applyPage(page.messages || []);
    await saveCursor(accountId, conversationId, page.next_cursor);
    hasMore = page.has_more;
    if (!hasMore) return page.next_cursor;
    if (page.next_cursor === cursor) throw new Error('sync cursor made no progress');
    cursor = page.next_cursor;
  }
  return cursor;
}
