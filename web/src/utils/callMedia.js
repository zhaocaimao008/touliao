export const VIDEO_CAPTURE = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
export function videoConstraints(enabled) { return enabled ? VIDEO_CAPTURE : false; }
export async function capVideoBitrate(pc, maxBps = 2_500_000) {
  if (!pc) return;
  try {
    pc.getSenders().filter(s => s.track && s.track.kind === 'video').forEach(sender => {
      const p = sender.getParameters();
      if (p.encodings && p.encodings.length) { p.encodings[0].maxBitrate = maxBps; sender.setParameters(p).catch(() => {}); }
    });
  } catch { /* 浏览器不支持即忽略 */ }
}
