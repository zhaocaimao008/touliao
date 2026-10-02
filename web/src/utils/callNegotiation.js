/**
 * 纯逻辑：通话重协商（ICE restart / 语音↔视频切换）四端统一协议（2026-10，Web/Windows
 * 与 Android/iOS 同步实现）。不依赖 React/socket，方便单测；CallModal / GroupCallModal
 * 只是调用方。
 *
 * 协议要点：
 *  1. 1v1：只有主叫（outgoing）在 ICE disconnected/failed 时发起 restart offer；被叫不主动
 *     restart，只应答（被叫长时间 failed 仍按原窗口逻辑最终挂断）。
 *  2. 完美协商（perfect negotiation）：1v1 主叫 impolite、被叫 polite；群通话每个 peer
 *     按 userId 字符串比较，较小者 impolite 且负责 restart。
 *     收到 offer 时本端 signalingState==='have-local-offer'（撞车）：
 *       polite   → 先 setLocalDescription({type:'rollback'}) 再处理对方 offer 并应答；
 *       impolite → 忽略对方 offer（对方会 rollback 后应答我方 offer）。
 *  3. 收到 answer 时若不在 'have-local-offer'，直接忽略（迟到/重复应答），不挂断不移除。
 *  4. 信令断线期间不发 offer；socket 重连（并完成 resume）后若仍 'have-local-offer'，
 *     重发当前 localDescription。
 */

/** 1v1：被叫为 polite 端（撞车时让步回滚），主叫为 impolite 端。 */
export function isPoliteForDirection(direction) {
  return direction === 'incoming';
}

/** 1v1：只有主叫负责 ICE restart（被叫只应答，避免双端同时 restart 撞车）。 */
export function canInitiateIceRestart(direction) {
  return direction === 'outgoing';
}

/** 群通话：按 userId 字符串比较，较小者 impolite（且负责 restart）。 */
export function isGroupPeerImpolite(selfId, peerId) {
  return String(selfId) < String(peerId);
}

/**
 * 收到对端 offer 时的处理动作。
 * @returns {'accept'|'rollback'|'ignore'}
 *   accept   = 无撞车，直接 setRemoteDescription + 应答
 *   rollback = 撞车且本端 polite：先回滚本地 offer 再应答
 *   ignore   = 撞车且本端 impolite：忽略对方 offer
 */
export function offerCollisionAction({ signalingState, polite }) {
  if (signalingState !== 'have-local-offer') return 'accept';
  return polite ? 'rollback' : 'ignore';
}

/**
 * 按协议为处理远端 offer 做准备（必要时回滚本地 offer）。
 * @returns {Promise<'accept'|'rollback'|null>} null = 本端 impolite，应忽略该 offer
 */
export async function prepareForRemoteOffer(pc, polite) {
  const action = offerCollisionAction({ signalingState: pc?.signalingState, polite });
  if (action === 'ignore') return null;
  if (action === 'rollback') await pc.setLocalDescription({ type: 'rollback' });
  return action;
}

/** answer 只在本端有待应答的 offer 时才可应用；否则是迟到/重复应答，直接忽略。 */
export function shouldApplyAnswer(signalingState) {
  return signalingState === 'have-local-offer';
}

/** socket 重连后：本端 offer 仍在等应答（断线期间发出/未发出）→ 需要重发 localDescription。 */
export function shouldResendLocalOffer(pc) {
  return !!pc && pc.signalingState === 'have-local-offer' && pc.localDescription?.type === 'offer';
}

/** 信令通道是否可发送（断线期间不发 offer，等重连/resume 后统一重发）。 */
export function isSignalingOnline(socket) {
  return !!socket && socket.connected !== false;
}

/**
 * 应答 offer 后的通话状态：已接通的通话（重协商 / ICE restart / 切视频）保持 connected，
 * 不回退到「连接中」——否则计时归零、且 connected 才触发的断网挂断逻辑失效。
 */
export function statusAfterAnswer(current) {
  return current === 'connected' ? 'connected' : 'connecting';
}
