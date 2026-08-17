'use strict';
/**
 * Socket.IO 事件负载守卫（P0-002 修复）
 *
 * 背景：call:request 等事件对客户端负载做解构（`({ to, type }) => ...`），
 * 客户端传 null / undefined / 字符串 / 数字 / 数组时直接抛 TypeError；
 * 且 to 传对象/数组时 better-sqlite3 .get(to, userId) 也会同步抛异常。
 * 单个恶意事件即可把整个进程打进未捕获异常路径（进程级兜底仅是记录日志，
 * 但异常后的状态不可预期，且可被攻击者按冷却节奏稳定触发）。
 *
 * 原则：服务端把客户端输入一律视为 UNTRUSTED，任何事件入口先过守卫，
 * 非法输入 → 拒绝 + 记录安全日志 + 返回统一错误码，进程保持正常。
 */
const MAX_ID_LEN = 64;

/**
 * 是否为「普通对象」（排除 null / 数组 / 原始类型）
 */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 事件入口守卫：负载必须是普通对象。
 * @returns {object|null} 合法时返回负载对象，非法时返回 null（已 emit 统一错误）
 */
function guardPayload(socket, eventName, payload) {
  if (isPlainObject(payload)) return payload;
  console.warn(`[realtime] 非法负载被拒绝 event=${eventName} type=${typeof payload} from=${socket.user?.id}`);
  socket.emit('call:error', { code: 'INVALID_CALL_REQUEST', event: eventName });
  return null;
}

/**
 * ID 字段校验：必须是字符串、非空、长度受限。
 * 返回清洗后的值或 null。
 */
function guardId(socket, eventName, fieldName, value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LEN) {
    return value;
  }
  console.warn(`[realtime] 非法ID被拒绝 event=${eventName} field=${fieldName} type=${typeof value} from=${socket.user?.id}`);
  socket.emit('call:error', { code: 'INVALID_CALL_REQUEST', event: eventName, field: fieldName });
  return null;
}

module.exports = { isPlainObject, guardPayload, guardId, MAX_ID_LEN };
