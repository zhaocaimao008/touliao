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
        // 洞B(2026-09-02)：更新后相邻 seq 校验——若该消息因历史错位(洞A时期/旧 outbox
        // pending 重发成功)卡在错误槽位，此处自愈：取出后按新 seq 重插（见 AUDIT.md）。
        if (violatesOrder(result, at)) {
          const moved = result.splice(at, 1)[0];
          insertBySeq(result, moved);
        }
        index = buildIndex();
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
  // dev only：插入前有序断言。条件【直接内联】——vite 把 import.meta.env.MODE 替换为字面量后
  // esbuild 在语法层折叠 if(false) 整块消除，生产/Electron 零残留（勿改经变量中转，见下注）。
  if (import.meta.env.MODE === 'development' || import.meta.env.MODE === 'test') assertSortedOrRepair(arr);
  arr.splice(lowerBoundSeq(arr, seq), 0, msg);
}

// 洞B：相邻序校验（忽略 pending）。arr[i] 与最近的真实邻居逆序 → true。O(1)（pending 数极少）。
// 正确性依据：server_sequence 在 (conversation_id, server_sequence) 上 UNIQUE（schema.js:580），
// 任何全局错位必存在相邻逆序对 → 只查最近邻居即可检出，无需整段扫描。
export function violatesOrder(arr, i) {
  const seq = seqOf(arr[i]);
  if (seq == null) return false;
  let l = i - 1; while (l >= 0 && seqOf(arr[l]) == null) l--;
  if (l >= 0 && seqOf(arr[l]) > seq) return true;
  let r = i + 1; while (r < arr.length && seqOf(arr[r]) == null) r++;
  if (r < arr.length && seqOf(arr[r]) < seq) return true;
  return false;
}

// dev 有序性断言（2026-09-02）：插入前校验数组真实消息 seq 单调；违序 → console.error +
// 降级全量排序（真实按 seq、pending 排末尾）。
//
// ⚠️ 生效条件必须【直接内联在 if 里，不能经变量中转】：vite 构建时把 import.meta.env.MODE
// 替换为字面量（production → "production"；Electron build:web 用 --mode desktop → "desktop"），
// esbuild 随即把 `"production"==="development"` 在语法层折叠为 false → if(false) 整块消除 →
// assertSortedOrRepair 无引用被删除，生产/Electron 产物零残留（实测验证过产物 grep）。
// 若写成 `const isDev = ...; if (isDev) ...`：esbuild 不做变量常量传播，产物里会残留
// `var isDev=!1` + 完整断言函数 + console.error 字符串（2026-09-02 实测踩坑，见 AUDIT）。
// 也不能用 import.meta.env.DEV：Vite 语义 DEV = mode!=='production'，--mode desktop 会误命中。
function assertSortedOrRepair(arr) {
  let prev = -1;
  for (const m of arr) {
    const s = seqOf(m);
    if (s == null) continue;
    if (s < prev) {
      console.error('[messageSync] 数组未按 server_sequence 有序(忽略 pending),降级全量排序',
        arr.map(m => ({ id: m?.id, seq: seqOf(m) })));
      const pendings = arr.filter(m => seqOf(m) == null);
      const reals = arr.filter(m => seqOf(m) != null).sort((a, b) => seqOf(a) - seqOf(b));
      arr.length = 0;
      arr.push(...reals, ...pendings);
      return;
    }
    prev = s;
  }
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
