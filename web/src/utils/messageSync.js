export function applySyncEvents(currentMessages, events) {
  // 2026-09-02 重写：不再「全量重排」（旧实现无 server_sequence 的本地 pending 消息
  // 兜底 MAX 排末尾 → 失败消息被甩到最新位置）。改为「保持当前有序数组 + 事件按序插入」：
  //  - 已撤回/已编辑 → 按 id 就地更新/删除，不移动位置
  //  - 新消息 → 按 server_sequence 二分插入（数组本按 sequence 有序）
  //  - 乐观占位（client_msg_id 命中）→ 删除占位，真实消息按 sequence 插入
  //  - 无 sequence 的本地 pending 消息不参与排序 → 位置天然保持
  //
  // 2026-09-02 洞A修复（审计详见 AUDIT.md）：旧实现插入比较把无 seq 的 pending 当 0（`|| 0`），
  // 一旦 pending 被锚到数组中间（outbox 按客户端 created_at 混排所致），二分中位探测会被 0
  // 带偏、跳过含正确插入点的区间 → 新消息插错位且不自愈。修复：插入比较完全忽略 pending
  // （视为透明锚点，见 insertBySeq/lowerBoundSeq），pending 槽位不漂移、真实消息恒有序。
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
        // 新消息：按 server_sequence 有序插入（忽略 pending，洞A）
        insertBySeq(result, event.message);
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

// ── 有序插入 helper（2026-09-02 洞A/B 共用）────────────────────────
// pending = server_sequence 为 null/undefined 的本地消息（未落库）。
// seqOf：pending → null，真实消息 → Number。
function seqOf(m) {
  if (!m) return null;
  const s = m.server_sequence;
  return (s == null || s === '') ? null : Number(s);
}

// 第一个真实消息（seq 非 null）中 server_sequence >= target 的物理下标；无 → 数组末尾。
// 线性 O(n)：数组物理上可能被 pending 打洞、无法直接二分；n 与既有 splice/重建 index 同阶，
// sync 属低频路径（重连/恢复/补拉），量级可接受。
function lowerBoundSeq(arr, target) {
  for (let i = 0; i < arr.length; i++) {
    const s = seqOf(arr[i]);
    if (s != null && s >= target) return i;
  }
  return arr.length;
}

// 按 server_sequence 插入（pending 透明：不参与比较、槽位不被挤走）。
// 供 messageSync 内部与 ChatWindow ack 落地共用。
export function insertBySeq(arr, msg) {
  const seq = seqOf(msg);
  if (seq == null) { arr.push(msg); return; } // 防御：事件消息理论必有 seq
  arr.splice(lowerBoundSeq(arr, seq), 0, msg);
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
