export function applySyncEvents(currentMessages, events) {
  // 2026-09-02 重写：不再「全量重排」（旧实现无 server_sequence 的本地 pending 消息
  // 兜底 MAX 排末尾 → 失败消息被甩到最新位置）。改为「保持当前有序数组 + 事件按序插入」：
  //  - 已撤回/已编辑 → 按 id 就地更新/删除，不移动位置
  //  - 新消息 → 按 server_sequence 二分插入（数组本按 sequence 有序）
  //  - 乐观占位（client_msg_id 命中）→ 删除占位，真实消息按 sequence 插入
  //  - 无 sequence 的本地 pending 消息不参与任何排序 → 位置天然保持
  const result = [...(currentMessages || []).filter(Boolean)];
  const buildIndex = () => {
    const idx = new Map();
    for (let i = 0; i < result.length; i++) idx.set(String(result[i].id), i);
    return idx;
  };
  let index = buildIndex();
  for (const event of [...(events || [])].sort((a, b) => a.server_sequence - b.server_sequence)) {
    const key = String(event.message_id);
    if (event.event_type === 'message_created') {
      if (!event.message) continue;
      // 乐观占位替换：client_msg_id 命中的本地消息删除（让位给真实消息，避免双显）
      const optimisticKey = event.message.client_msg_id;
      if (optimisticKey) {
        for (let i = result.length - 1; i >= 0; i--) {
          const m = result[i];
          if (m && (m._tempId === optimisticKey || String(m.id) === String(optimisticKey))) result.splice(i, 1);
        }
        index = buildIndex();
      }
      const at = index.get(key);
      if (at !== undefined) {
        result[at] = { ...result[at], ...event.message };   // 已有：就地更新（如重发确认）
      } else {
        // 新消息：二分插入保持 sequence 序
        const seq = event.message.server_sequence || 0;
        let lo = 0, hi = result.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if ((result[mid]?.server_sequence || 0) < seq) lo = mid + 1; else hi = mid;
        }
        result.splice(lo, 0, event.message);
        index = buildIndex();
      }
    } else if (event.event_type === 'message_edited') {
      const at = index.get(key);
      if (at !== undefined) result[at] = { ...result[at], content: event.payload?.content ?? result[at].content, edited: 1 };
    } else if (['message_recalled', 'message_deleted_for_me', 'message_vanished'].includes(event.event_type)) {
      const at = index.get(key);
      if (at !== undefined) { result.splice(at, 1); index = buildIndex(); }
    }
  }
  return result;
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
