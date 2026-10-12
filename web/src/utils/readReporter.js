// 已读上报节流器（POST /api/messages/conversation/:id/read）
//
// 线上该接口是第一大路由（单客户端峰值 78 次/分钟）：打开会话、每次 messages 变化、
// 切换会话、beforeunload 各自无条件上报。这里统一收口：
//   1. 单调去重：仅当「已看到的最新消息」比该会话上次上报的更新时才发；
//   2. 每会话尾随防抖（默认 800ms），短时间内多次触发合并为一次；
//   3. 页面不可见时不发，等可见后再补发（用户没看到就不算已读）。
import axios from 'axios';

export const READ_DEBOUNCE_MS = 800;
export const READ_MAX_WAIT_MS = 3000;

// convId -> { key, id }：已成功发出的最新位置
const reported = new Map();
// convId -> { key, id, timer }：待发送
const pending = new Map();
let visibilityHooked = false;

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * 计算消息的排序键 { seq, ts }：server_sequence（服务端单调）与 created_at（秒/毫秒/ISO）。
 * 两者量纲不同，比较时只在双方都有同一字段时比；都没有则退化为 id 不同即视为更新。
 */
export function readKeyOf(msg) {
  if (!msg) return null;
  const seqN = Number(msg.server_sequence);
  const seq = Number.isFinite(seqN) && seqN > 0 ? seqN : null;
  let ts = null;
  if (msg.created_at != null) {
    const n = typeof msg.created_at === 'number' ? msg.created_at : Date.parse(msg.created_at);
    if (Number.isFinite(n)) ts = n;
  }
  return seq == null && ts == null ? null : { seq, ts };
}

/** 「是否更新」：同字段可比时比大小，否则比 id 是否不同。 */
export function isNewer(next, prev) {
  if (!prev) return true;
  if (next.id == null) return false; // 「取最新」型上报，已有记录时不重复
  if (next.id === prev.id) return false;
  const a = next.key, b = prev.key;
  if (a && b) {
    if (a.seq != null && b.seq != null) return a.seq > b.seq;
    if (a.ts != null && b.ts != null && a.ts !== b.ts) return a.ts > b.ts;
  }
  return true;
}

function hookVisibility() {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (!isVisible()) return;
    for (const [convId, p] of pending) {
      if (!p.timer) schedule(convId, p);
    }
  });
}

function send(convId, entry, { keepalive = false } = {}) {
  const prev = reported.get(convId);
  if (!isNewer(entry, prev)) return;
  reported.set(convId, { key: entry.key, id: entry.id });
  const body = entry.id != null ? { messageId: entry.id } : {};
  if (keepalive) {
    sendKeepalive(convId, body);
    return;
  }
  try {
    const r = axios.post(`/api/messages/conversation/${convId}/read`, body);
    r?.catch?.(() => {
      // 失败则回滚，下次触发可重试
      if (reported.get(convId)?.id === entry.id) {
        if (prev) reported.set(convId, prev); else reported.delete(convId);
      }
    });
  } catch { /* ignore */ }
}

let keepaliveSender = null;
/** ChatWindow 注入：页面卸载时用 fetch keepalive 投递（带 CSRF/Bearer）。 */
export function setKeepaliveSender(fn) { keepaliveSender = fn; }
function sendKeepalive(convId, body) {
  try {
    if (keepaliveSender) keepaliveSender(convId, body);
    else axios.post(`/api/messages/conversation/${convId}/read`, body).catch(() => {});
  } catch { /* ignore */ }
}

function schedule(convId, p, delay = READ_DEBOUNCE_MS) {
  clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    p.timer = null;
    if (!isVisible()) { hookVisibility(); return; } // 保留 pending，等可见再发
    pending.delete(convId);
    send(convId, p);
  }, delay);
}

/**
 * 记录「用户已看到 msg（null = 打开会话、让后端取最新）」，防抖后上报。
 * @param {string|number} convId
 * @param {object|null} msg 最新已看到的消息（含 id / server_sequence / created_at）
 */
export function reportRead(convId, msg = null) {
  if (convId == null || convId === '' || convId === '__file-helper__') return;
  if (msg && msg._tempId && msg.id === msg._tempId) return; // 未落库的乐观消息不上报
  const entry = { key: readKeyOf(msg), id: msg ? msg.id ?? null : null };
  const p = pending.get(convId);
  if (p) {
    // 待发队列只前进不后退；「取最新」型不覆盖已有待发
    if (entry.id == null) return;
    if (p.id != null && !isNewer(entry, p)) return;
    p.key = entry.key; p.id = entry.id;
    // 尾随防抖；持续有新消息时最多推迟 READ_MAX_WAIT_MS，避免永远不发
    if (Date.now() - p.since < READ_MAX_WAIT_MS) schedule(convId, p);
    else if (!p.timer && isVisible()) schedule(convId, p, 0);
    return;
  }
  if (!isNewer(entry, reported.get(convId))) return;
  const np = { key: entry.key, id: entry.id, timer: null, since: Date.now() };
  pending.set(convId, np);
  hookVisibility();
  schedule(convId, np);
}

/**
 * 立即发出该会话的待发已读（切换会话 / 页面卸载）。不可见时丢弃（用户未看到）。
 */
export function flushRead(convId, { keepalive = false } = {}) {
  const p = pending.get(convId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(convId);
  if (!isVisible()) return;
  send(convId, p, { keepalive });
}

/**
 * 从消息数组尾部找最新一条「已落库」消息（跳过发送中/失败的乐观消息）。
 * @param {Array} messages
 * @param {string|number} [convId] 给定时只接受属于该会话的消息（防跨会话残留）
 */
export function lastReadableMessage(messages, convId) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.id == null) continue;
    if (m._status === 'sending' || m._status === 'error') continue;
    if (m._tempId && m.id === m._tempId) continue;
    if (convId != null && m.conversation_id != null && String(m.conversation_id) !== String(convId)) return null;
    return m;
  }
  return null;
}

/**
 * 外部（如右键「标记已读/未读」）改变服务端状态后，重置去重基线。
 * ChatWindow 每次打开会话也会调用：「打开 = 至少一次已读上报」（同 Android
 * ReadReporter.onConversationOpened）。否则在别的设备/标签页「标为未读」
 * （服务端 manually_unread=1，无 socket 事件）后，本标签页再打开该会话时两次上报
 * 都被去重吞掉，服务端标记永远清不掉。
 */
export function resetReadState(convId) {
  const p = pending.get(convId);
  if (p) clearTimeout(p.timer);
  pending.delete(convId);
  reported.delete(convId);
}

/**
 * 会话边界（登录/登出/切换账号或服务器）：清空全部去重基线与待发队列。
 * 模块级状态跨会话存活（登出→登录不刷新页面），不清会让新账号继承上个账号的
 * 已读基线（该发的已读被去重吞掉），或把上个账号挂起的已读在新会话里发出。
 */
export function resetAllReadState() {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  reported.clear();
}

/** 仅测试用 */
export function __resetReadReporterForTests() {
  resetAllReadState();
}
