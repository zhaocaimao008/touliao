// ── 离线消息历史缓存（Web/Windows · IndexedDB）────────────────────────
// 契约见 docs/offline-message-cache-contract.md。定位：首屏占位缓存，非真相源。
// 只存「已被服务端确认的历史消息」(真实 id)；未确认/失败消息由 outbox 负责。
// 任何 IndexedDB 异常（隐私模式/配额满/被禁用）一律静默降级，不影响主流程。

const DB_NAME = 'vxin';
const STORE = 'msgcache_v1';       // schema 版本前缀；破坏性变更时改此名弃用旧库
const MAX_PER_CONV = 50;           // 与 outbox 一致，每会话最近 50 条

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          // key = conversationId；value = { convId, msgs:[...] }
          db.createObjectStore(STORE, { keyPath: 'convId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);   // 打不开 → 降级为无缓存
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

// 归一化：只留有真实 id 的消息，按 created_at 升序 + id tie-break，截断最近 50。
function normalize(msgs) {
  const seen = new Set();
  const cleaned = [];
  for (const m of msgs) {
    if (!m || !m.id || m._tempId) continue;        // 无真实 id / 乐观消息不入缓存
    if (m.burn_after) continue;                    // 阅后即焚绝不落盘（隐私红线）
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    cleaned.push(m);
  }
  cleaned.sort((a, b) =>
    (a.created_at || 0) - (b.created_at || 0) ||
    String(a.id).localeCompare(String(b.id))
  );
  return cleaned.slice(-MAX_PER_CONV);
}

// dedupById：server 版本覆盖 cache 版本（解决「缓存旧、服务端已编辑」）。
export function mergeById(cached, server) {
  const map = new Map();
  for (const m of cached || []) if (m && m.id && !m._tempId) map.set(String(m.id), m);
  for (const m of server || []) if (m && m.id && !m._tempId) map.set(String(m.id), m); // server 覆盖
  return normalize([...map.values()]);
}

// 读取会话缓存（最近 50，升序）。任何异常 → 返回 []。
export async function loadCache(convId) {
  if (!convId) return [];
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = tx(db, 'readonly').get(String(convId));
      req.onsuccess = () => resolve(req.result?.msgs || []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

// 覆写会话缓存（内部归一化 + 截断）。异常静默。
export async function saveCache(convId, msgs) {
  if (!convId) return;
  const db = await openDB();
  if (!db) return;
  const clean = normalize(msgs || []);
  return new Promise((resolve) => {
    try {
      if (!clean.length) {
        const req = tx(db, 'readwrite').delete(String(convId));
        req.onsuccess = req.onerror = () => resolve();
        return;
      }
      const req = tx(db, 'readwrite').put({ convId: String(convId), msgs: clean });
      req.onsuccess = req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

// 删除单条（撤回/删除）。
export async function removeFromCache(convId, msgId) {
  if (!convId || msgId == null) return;
  const cur = await loadCache(convId);
  const next = cur.filter(m => String(m.id) !== String(msgId));
  if (next.length !== cur.length) await saveCache(convId, next);
}

// 清理：有 convId=清该会话；无参=清全部（登出/切账号，隐私红线）。
export async function clearCache(convId) {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const store = tx(db, 'readwrite');
      const req = convId != null ? store.delete(String(convId)) : store.clear();
      req.onsuccess = req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export const __TESTING__ = { normalize, MAX_PER_CONV, STORE, DB_NAME };
