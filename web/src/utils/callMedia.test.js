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
