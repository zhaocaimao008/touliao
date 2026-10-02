import { describe, expect, it, vi } from 'vitest';
import {
  canInitiateIceRestart,
  isGroupPeerImpolite,
  isPoliteForDirection,
  isSignalingOnline,
  offerCollisionAction,
  prepareForRemoteOffer,
  shouldApplyAnswer,
  shouldResendLocalOffer,
  statusAfterAnswer,
} from './callNegotiation';

// 四端统一重协商协议（Web/Windows 与 Android/iOS 同步）：这些断言就是协议本身，
// 改动任何一条都必须四端一起改。
describe('1v1 角色', () => {
  it('被叫 polite、主叫 impolite', () => {
    expect(isPoliteForDirection('incoming')).toBe(true);
    expect(isPoliteForDirection('outgoing')).toBe(false);
  });

  it('只有主叫发起 ICE restart，被叫只应答', () => {
    expect(canInitiateIceRestart('outgoing')).toBe(true);
    expect(canInitiateIceRestart('incoming')).toBe(false);
  });
});

describe('群通话角色（按 userId 字符串比较）', () => {
  it('较小者 impolite（负责 restart），较大者 polite', () => {
    expect(isGroupPeerImpolite('a1', 'b2')).toBe(true);
    expect(isGroupPeerImpolite('b2', 'a1')).toBe(false);
  });

  it('按字符串而不是数值比较（与原生端一致）', () => {
    expect(isGroupPeerImpolite('10', '9')).toBe(true);
    expect(isGroupPeerImpolite(10, '9')).toBe(true);
  });

  it('任意一对成员恰有一方 impolite', () => {
    const ids = ['u1', 'u2', 'abc', 'ABC', '100'];
    for (const x of ids) for (const y of ids) {
      if (x === y) continue;
      expect(isGroupPeerImpolite(x, y)).not.toBe(isGroupPeerImpolite(y, x));
    }
  });
});

describe('offer 撞车处理', () => {
  it('无撞车直接应答', () => {
    for (const signalingState of ['stable', 'have-remote-offer', undefined]) {
      expect(offerCollisionAction({ signalingState, polite: false })).toBe('accept');
      expect(offerCollisionAction({ signalingState, polite: true })).toBe('accept');
    }
  });

  it('have-local-offer 时 polite 回滚、impolite 忽略', () => {
    expect(offerCollisionAction({ signalingState: 'have-local-offer', polite: true })).toBe('rollback');
    expect(offerCollisionAction({ signalingState: 'have-local-offer', polite: false })).toBe('ignore');
  });

  it('polite 端先 setLocalDescription(rollback) 再处理对方 offer', async () => {
    const pc = { signalingState: 'have-local-offer', setLocalDescription: vi.fn(async () => { pc.signalingState = 'stable'; }) };
    expect(await prepareForRemoteOffer(pc, true)).toBe('rollback');
    expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: 'rollback' });
    expect(pc.signalingState).toBe('stable');
  });

  it('impolite 端忽略 offer，不碰本地描述', async () => {
    const pc = { signalingState: 'have-local-offer', setLocalDescription: vi.fn() };
    expect(await prepareForRemoteOffer(pc, false)).toBeNull();
    expect(pc.setLocalDescription).not.toHaveBeenCalled();
  });

  it('stable 下双方都直接应答', async () => {
    const pc = { signalingState: 'stable', setLocalDescription: vi.fn() };
    expect(await prepareForRemoteOffer(pc, false)).toBe('accept');
    expect(await prepareForRemoteOffer(pc, true)).toBe('accept');
    expect(pc.setLocalDescription).not.toHaveBeenCalled();
  });
});

describe('answer / 重连重发', () => {
  it('只在 have-local-offer 时应用 answer，其余直接忽略', () => {
    expect(shouldApplyAnswer('have-local-offer')).toBe(true);
    expect(shouldApplyAnswer('stable')).toBe(false);
    expect(shouldApplyAnswer('have-remote-offer')).toBe(false);
  });

  it('重连后仅在本地 offer 仍待应答时重发 localDescription', () => {
    expect(shouldResendLocalOffer({ signalingState: 'have-local-offer', localDescription: { type: 'offer', sdp: 'v=0' } })).toBe(true);
    expect(shouldResendLocalOffer({ signalingState: 'stable', localDescription: { type: 'answer', sdp: 'v=0' } })).toBe(false);
    expect(shouldResendLocalOffer({ signalingState: 'have-local-offer', localDescription: null })).toBe(false);
    expect(shouldResendLocalOffer(null)).toBe(false);
  });

  it('断线期间信令不可发', () => {
    expect(isSignalingOnline({ connected: true })).toBe(true);
    expect(isSignalingOnline({ connected: false })).toBe(false);
    expect(isSignalingOnline(null)).toBe(false);
  });
});

describe('应答后的通话状态', () => {
  it('已接通的重协商不回退到「连接中」（计时不归零、断网挂断仍生效）', () => {
    expect(statusAfterAnswer('connected')).toBe('connected');
  });

  it('首次应答进入连接中', () => {
    expect(statusAfterAnswer('connecting')).toBe('connecting');
    expect(statusAfterAnswer('calling')).toBe('connecting');
  });
});
