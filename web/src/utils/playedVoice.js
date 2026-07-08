// ================================================================
// playedVoice.js — 已播放语音消息记录（用于「未播放」红点）
// ----------------------------------------------------------------
// 微信式体验：收到的语音消息未播放时,气泡旁显示红点;播放后红点消失且不再出现。
// 已播放的消息 id 记到 localStorage(仅需布尔集合),跨刷新/重开持久。
// 上限 2000 条,超出淘汰最旧(FIFO),避免无限增长。
// ================================================================

const KEY = 'played_voice_v1';
const MAX = 2000;

let mem = null;
function load() {
  if (mem) return mem;
  mem = new Set();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) for (const id of JSON.parse(raw)) mem.add(id);
  } catch { /* 解析失败：空集合 */ }
  return mem;
}

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      let arr = [...load()];
      if (arr.length > MAX) arr = arr.slice(arr.length - MAX);
      localStorage.setItem(KEY, JSON.stringify(arr));
    } catch { /* 满/隐私模式：静默降级 */ }
  }, 400);
}

/** 该语音是否已播放过 */
export function isVoicePlayed(id) {
  if (!id) return true;   // 无 id 视为已播放(不显示红点)
  return load().has(id);
}

/** 标记该语音已播放 */
export function markVoicePlayed(id) {
  if (!id) return;
  const s = load();
  if (s.has(id)) return;
  s.add(id);
  scheduleFlush();
}
