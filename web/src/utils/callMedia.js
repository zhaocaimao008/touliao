export const VIDEO_CAPTURE = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
export function videoConstraints(enabled) { return enabled ? VIDEO_CAPTURE : false; }

// H264 优先（2026-09-05 通话修复批）：原生端（iOS/Android）对 VP8 硬解不可用/受限，
// H264 互通成功率更高、移动端功耗更低。编解码偏好必须在 createOffer/createAnswer 之前
// 设到 transceiver 上才生效——调用点统一放在 addTrack 之后、发 offer/answer 之前，
// 以及被叫 setRemoteDescription 之后、createAnswer 之前（远端 offer 可能新建我方
// 未 addTrack 的视频 transceiver）。setCodecPreferences 对该 transceiver 后续协商持续有效。
// Safari 支持有限，整体 try/catch 静默降级为浏览器默认编码顺序。
export async function preferH264(pc) {
  try {
    const trs = pc.getTransceivers ? pc.getTransceivers() : [];
    // sender（本端 addTrack）或 receiver（远端 offer 创建）任一 track 是视频即命中
    const tr = trs.find(t => t.sender?.track?.kind === 'video' || t.receiver?.track?.kind === 'video');
    const sender = tr?.sender;
    if (!sender || !sender.setCodecPreferences) return;
    const prefs = RTCRtpSender.getCapabilities('video')?.codecs || [];
    const pick = (m) => prefs.find(c => c.mimeType.toLowerCase().includes(m));
    const h264 = pick('h264');
    const vp8 = pick('vp8');
    if (h264) sender.setCodecPreferences([h264, vp8, ...prefs.filter(c => c !== h264 && c !== vp8)].filter(Boolean));
  } catch { /* 不支持（如 Safari）即维持默认编码顺序 */ }
}

// maxBps：发送码率上限（1v1 默认 2.5M 不变；群 mesh 按人数降档传入，见 capForPeerCount）。
// degrade：true 时对 encodings[0] 设 scaleResolutionDownBy=2（720p 采集→360p 档编码负载，
// 群 ≥4 人时压 CPU）；传 false 会显式清掉该字段，人数回落后才能恢复全分辨率。
export async function capVideoBitrate(pc, maxBps = 2_500_000, degrade = false) {
  if (!pc) return;
  try {
    pc.getSenders().filter(s => s.track && s.track.kind === 'video').forEach(sender => {
      const p = sender.getParameters();
      // 初始协商完成前 encodings 可能为空：补一个空 encoding 再设，否则上限落不上
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = maxBps;
      if (degrade) p.encodings[0].scaleResolutionDownBy = 2;
      else delete p.encodings[0].scaleResolutionDownBy;
      // Chrome 扩展字段（RTCRtpSendParameters.degradationPreference）：带宽不够时优先保
      // 分辨率、牺牲帧率；非标准字段，不存在的浏览器自动跳过。
      if ('degradationPreference' in p) p.degradationPreference = 'maintain-resolution';
      sender.setParameters(p).catch(() => {});
    });
  } catch { /* 浏览器不支持即忽略 */ }
}
