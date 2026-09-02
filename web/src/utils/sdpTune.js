'use strict';
/**
 * 弱网调优：SDP munging（2026-09-02）。
 * 显式开启 Opus inband FEC + 码率上限 + 单声道，提升 20-30% 丢包场景可懂度。
 * 1对1 与群通话（mesh）共用。
 */
export function tuneSdpForWeakNetwork(sdp) {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
  if (!m) return sdp; // 没有 Opus 的 SDP（异常）不动
  const pt = m[1];
  const params = 'useinbandfec=1;maxaveragebitrate=64000;stereo=0';
  const fmtpRe = new RegExp(`a=fmtp:${pt}[^\r\n]*`);
  if (fmtpRe.test(sdp)) {
    return sdp.replace(fmtpRe, (line) => {
      const existing = line.replace(new RegExp(`^a=fmtp:${pt}\\s*`), '');
      const out = [];
      const seen = new Set();
      for (const p of [...existing.split(';').map(s => s.trim()).filter(Boolean), ...params.split(';')]) {
        const key = p.split('=')[0];
        if (!seen.has(key)) { seen.add(key); out.push(p); }
      }
      return `a=fmtp:${pt} ${out.join(';')}`;
    });
  }
  // 无 fmtp 行（罕见）：在 rtpmap 后补一行
  return sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000/2\\r?\\n)`), `$1a=fmtp:${pt} ${params}\r\n`);
}
