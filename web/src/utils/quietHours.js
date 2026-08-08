/**
 * 勿扰时段工具：判断当前时刻是否落在 HH:MM 区间内。
 * 与后端 src/utils/push.js isInQuietHours 保持相同语义，供前端预览 / 测试使用。
 *
 * @param {string} quietStart  "HH:MM"
 * @param {string} quietEnd    "HH:MM"
 * @param {Date}   [now]       当前时刻（默认 new Date()）
 * @returns {boolean}
 */
export function isInQuietHours(quietStart, quietEnd, now = new Date()) {
  const parse = (s) => {
    if (typeof s !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const start = parse(quietStart);
  const end = parse(quietEnd);
  if (start == null || end == null || start === end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return start < end
    ? (cur >= start && cur < end)
    : (cur >= start || cur < end);
}

/**
 * 校验 HH:MM 格式（给前端表单校验用）
 * @param {string} v
 * @returns {boolean}
 */
export function isValidHHMM(v) {
  if (typeof v !== 'string') return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

/**
 * 格式化 send_at Unix 时间戳为人可读的描述，供定时发送气泡提示用。
 * @param {number} sendAt  UNIX 秒
 * @returns {string}       如 "2025-08-09 14:30"
 */
export function formatScheduledTime(sendAt) {
  if (!Number.isFinite(sendAt)) return '';
  const d = new Date(sendAt * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
