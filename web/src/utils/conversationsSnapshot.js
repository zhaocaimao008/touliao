// ChatList 每次拉到 /api/messages/conversations 后在此发布快照，
// 其它模块（如 Home 的当前会话对端在线状态）复用这份数据，不再各自整表重拉。
let snapshot = null; // { at, list }
const listeners = new Set();

export function publishConversations(list) {
  if (!Array.isArray(list)) return;
  snapshot = { at: Date.now(), list };
  listeners.forEach(fn => { try { fn(list); } catch { /* ignore */ } });
}

export function getConversationsSnapshot() { return snapshot; }

export function subscribeConversations(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 测试用 */
export function __resetConversationsSnapshot() { snapshot = null; listeners.clear(); }
