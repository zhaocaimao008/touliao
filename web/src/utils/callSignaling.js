/**
 * 纯函数：1对1 通话信令的 callId 绑定与过滤（Task 5，2026-08-31）。
 *
 * 不依赖 socket/React，方便单测；CallModal.jsx/Home.jsx 只是调用方。
 */

/**
 * 判断一条收到的信令事件是否属于当前正在处理的这通通话——同时校验对端身份和
 * callId（如果双方都带了 callId 才比对；旧协议/缺失时不因为"查不到"而误判，
 * 只在真的对得上号却对不上 callId 时才拒绝，防止过期信令(重拨覆盖前的旧通话)
 * 误伤当前这通新通话）。
 *
 * @param {{ from?: string, callId?: string }} event 收到的事件 payload
 * @param {{ remoteId?: string, callId?: string }} activeCall 当前 UI 正在展示的通话
 * @returns {boolean}
 */
export function matchesCall(event, activeCall) {
  if (!event || !activeCall) return false;
  if (event.from !== activeCall.remoteId) return false;
  if (event.callId && activeCall.callId && event.callId !== activeCall.callId) return false;
  return true;
}

/**
 * 给一个信令 payload 补上 callId 字段（call:request 之后的所有事件都要带）。
 * callId 为空/未知时原样返回，不写入 undefined/null 字段污染 payload。
 *
 * @param {object} payload
 * @param {string} [callId]
 * @returns {object}
 */
export function withCallId(payload, callId) {
  return callId ? { ...payload, callId } : payload;
}
