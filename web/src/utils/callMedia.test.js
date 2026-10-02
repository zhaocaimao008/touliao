import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { preferH264 } from './callMedia';

// Q14 全修回归：setCodecPreferences 属于 RTCRtpTransceiver，不是 RTCRtpSender——用
// 标准形状的替身对象（sender 上没有 setCodecPreferences，只有 transceiver 有）复现
// 审计报告原文"真实 Chromium 检查 sender 原型为 undefined、transceiver 原型为 function"。
function videoTransceiver() {
  return {
    sender: { track: { kind: 'video' } },
    receiver: { track: null },
    setCodecPreferences: vi.fn(),
  };
}

describe('preferH264', () => {
  let originalRTCRtpSender;
  beforeAll(() => {
    originalRTCRtpSender = globalThis.RTCRtpSender;
    globalThis.RTCRtpSender = {
      getCapabilities: () => ({
        codecs: [
          { mimeType: 'video/VP8' },
          { mimeType: 'video/H264' },
          { mimeType: 'video/VP9' },
        ],
      }),
    };
  });
  afterAll(() => { globalThis.RTCRtpSender = originalRTCRtpSender; });

  it('sets codec preferences on the transceiver, not the sender (Q14 bug: sender has no such method)', async () => {
    const tr = videoTransceiver();
    const pc = { getTransceivers: () => [tr] };

    await preferH264(pc);

    expect(tr.setCodecPreferences).toHaveBeenCalledTimes(1);
    const [ordered] = tr.setCodecPreferences.mock.calls[0];
    expect(ordered[0].mimeType).toBe('video/H264');
    expect(ordered.map(c => c.mimeType)).toContain('video/VP8');
  });

  it('finds the video transceiver via the receiver track when this side has no sender track (answering an incoming offer)', async () => {
    const tr = { sender: { track: null }, receiver: { track: { kind: 'video' } }, setCodecPreferences: vi.fn() };
    const pc = { getTransceivers: () => [{ sender: { track: { kind: 'audio' } }, receiver: {}, setCodecPreferences: vi.fn() }, tr] };

    await preferH264(pc);

    expect(tr.setCodecPreferences).toHaveBeenCalledTimes(1);
  });

  it('does nothing (no throw) when there is no video transceiver yet', async () => {
    const pc = { getTransceivers: () => [] };
    await expect(preferH264(pc)).resolves.toBeUndefined();
  });

  it('degrades silently when the transceiver has no setCodecPreferences (e.g. Safari)', async () => {
    const tr = { sender: { track: { kind: 'video' } }, receiver: {} };
    const pc = { getTransceivers: () => [tr] };
    await expect(preferH264(pc)).resolves.toBeUndefined();
  });
});

describe('AUDIO_CONSTRAINTS', () => {
  it('显式开启回声消除/降噪/自动增益', async () => {
    const { AUDIO_CONSTRAINTS } = await import('./callMedia');
    expect(AUDIO_CONSTRAINTS).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  });
});

describe('shouldReacquireMic', () => {
  const liveTrack = (settings) => ({ readyState: 'live', getSettings: () => settings });
  const input = (deviceId, groupId) => ({ kind: 'audioinput', deviceId, groupId });

  it('音轨已结束（设备被拔）→ 重取', async () => {
    const { shouldReacquireMic } = await import('./callMedia');
    expect(shouldReacquireMic({ track: { readyState: 'ended' }, devices: [input('default', 'g2')] })).toBe(true);
  });

  it('没有任何输入设备 → 不重取', async () => {
    const { shouldReacquireMic } = await import('./callMedia');
    expect(shouldReacquireMic({ track: { readyState: 'ended' }, devices: [{ kind: 'audiooutput', deviceId: 'x' }] })).toBe(false);
  });

  it('当前设备已不在列表 → 重取', async () => {
    const { shouldReacquireMic } = await import('./callMedia');
    expect(shouldReacquireMic({ track: liveTrack({ deviceId: 'usb', groupId: 'g1' }), devices: [input('default', 'g2'), input('builtin', 'g2')] })).toBe(true);
  });

  it('系统默认输入换了（插耳机）→ 重取；没变 → 不动', async () => {
    const { shouldReacquireMic } = await import('./callMedia');
    const track = liveTrack({ deviceId: 'default', groupId: 'g1' });
    expect(shouldReacquireMic({ track, devices: [input('default', 'g2'), input('builtin', 'g1'), input('headset', 'g2')] })).toBe(true);
    expect(shouldReacquireMic({ track, devices: [input('default', 'g1'), input('builtin', 'g1')] })).toBe(false);
  });
});

describe('replaceMicTrack', () => {
  it('取当前默认麦克风并替换所有 sender，继承静音', async () => {
    const { replaceMicTrack, AUDIO_CONSTRAINTS } = await import('./callMedia');
    const track = { kind: 'audio', enabled: true };
    const getUserMedia = vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }));
    const senders = [{ replaceTrack: vi.fn(async () => {}) }, { replaceTrack: vi.fn(async () => {}) }];

    const result = await replaceMicTrack({ getUserMedia, senders, enabled: false });

    expect(getUserMedia).toHaveBeenCalledWith({ audio: AUDIO_CONSTRAINTS, video: false });
    expect(result).toBe(track);
    expect(track.enabled).toBe(false);
    senders.forEach(sender => expect(sender.replaceTrack).toHaveBeenCalledWith(track));
  });

  it('没取到音轨时停流并抛错', async () => {
    const { replaceMicTrack } = await import('./callMedia');
    const other = { stop: vi.fn() };
    const getUserMedia = async () => ({ getAudioTracks: () => [], getTracks: () => [other] });
    await expect(replaceMicTrack({ getUserMedia, senders: [], enabled: true })).rejects.toThrow();
    expect(other.stop).toHaveBeenCalled();
  });
});
