/**
 * 定时发送工具：与后端 scheduled.service.js 保持相同的时间约束（15 分钟 ~ 30 天）。
 */
export const SCHEDULE_MIN_DELTA = 15 * 60;        // 最少提前 15 分钟
export const SCHEDULE_MAX_DELTA = 30 * 24 * 3600; // 最多 30 天

/**
 * 校验计划发送时间（UNIX 秒）是否合法。
 * @param {number} sendAt  目标发送时刻（UNIX 秒）
 * @param {number} [nowSec] 当前时刻（UNIX 秒，默认取 Date.now()）
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateScheduleTime(sendAt, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Number.isFinite(sendAt)) return { ok: false, error: '时间格式不正确' };
  const delta = sendAt - nowSec;
  if (delta < SCHEDULE_MIN_DELTA) return { ok: false, error: '发送时间至少需在 15 分钟后' };
  if (delta > SCHEDULE_MAX_DELTA) return { ok: false, error: '发送时间最多为 30 天内' };
  return { ok: true };
}

/**
 * 将 <input type="datetime-local"> 的值转为 UNIX 秒。
 * @param {string} localValue  形如 "2025-08-09T14:30"
 * @returns {number|null}
 */
export function datetimeLocalToUnix(localValue) {
  if (typeof localValue !== 'string' || !localValue) return null;
  const ms = new Date(localValue).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

/**
 * 生成默认计划时间（当前 + 1 小时）的 datetime-local 字符串。
 * @param {Date} [now]
 * @returns {string}  "YYYY-MM-DDTHH:MM"
 */
export function defaultScheduleLocal(now = new Date()) {
  const d = new Date(now.getTime() + 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
