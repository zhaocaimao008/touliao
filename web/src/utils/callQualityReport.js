// 通话质量上报（POST /api/calls/:callId/report）。
// 1v1（CallModal）与群通话（GroupCallModal）共用：通话进行中从 getStats 采样累积
// RTT/丢包与选中的候选对，挂断后一次性 fire-and-forget 上报。
// 硬性约束：任何环节都不得抛错、不得阻塞挂断（全部 try/catch，发送延后到下一个宏任务）；
// 旧后端没有该路由（404）时静默忽略。
import axios from 'axios';

const CANDIDATE_TYPES = new Set(['host', 'srflx', 'prflx', 'relay']);
const PROTOCOLS = new Set(['udp', 'tcp']);
const RELAY_PROTOCOLS = new Set(['udp', 'tcp', 'tls']);

const pick = (set, v) => (typeof v === 'string' && set.has(v.toLowerCase()) ? v.toLowerCase() : null);

function statsGet(report, id) {
  if (!report || id == null) return null;
  if (typeof report.get === 'function') return report.get(id) || null;
  let found = null;
  statsForEach(report, s => { if (!found && s.id === id) found = s; });
  return found;
}

function statsForEach(report, fn) {
  if (!report) return;
  if (typeof report.forEach === 'function') report.forEach(s => fn(s));
  else if (typeof report[Symbol.iterator] === 'function') for (const s of report) fn(Array.isArray(s) ? s[1] : s);
}

/**
 * 从 RTCStatsReport 中解析当前选中的候选对：
 * transport.selectedCandidatePairId → candidate-pair → local/remote candidate。
 * 兼容不暴露 selectedCandidatePairId 的实现（Firefox：candidate-pair.selected；
 * 兜底 nominated && state==='succeeded'）。
 */
export function extractSelectedPair(report) {
  try {
    let pair = null;
    statsForEach(report, s => {
      if (!pair && s?.type === 'transport' && s.selectedCandidatePairId) pair = statsGet(report, s.selectedCandidatePairId);
    });
    if (!pair) statsForEach(report, s => { if (!pair && s?.type === 'candidate-pair' && s.selected) pair = s; });
    if (!pair) statsForEach(report, s => { if (!pair && s?.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
    if (!pair) return null;
    const local = statsGet(report, pair.localCandidateId) || {};
    const remote = statsGet(report, pair.remoteCandidateId) || {};
    const rtt = Number(pair.currentRoundTripTime);
    return {
      localCandidateType: pick(CANDIDATE_TYPES, local.candidateType),
      remoteCandidateType: pick(CANDIDATE_TYPES, remote.candidateType),
      protocol: pick(PROTOCOLS, local.protocol),
      relayProtocol: pick(RELAY_PROTOCOLS, local.relayProtocol),
      rttMs: Number.isFinite(rtt) ? rtt * 1000 : null,
    };
  } catch {
    return null;
  }
}

/** 汇总 inbound-rtp（音频+视频）累计丢包/收包。 */
export function inboundTotals(report) {
  let lost = 0, received = 0;
  try {
    statsForEach(report, s => {
      if (s?.type === 'inbound-rtp' && (s.kind === 'audio' || s.kind === 'video')) {
        lost += Math.max(0, Number(s.packetsLost) || 0);
        received += Math.max(0, Number(s.packetsReceived) || 0);
      }
    });
  } catch { /* ignore */ }
  return { lost, received };
}

export function detectPlatform() {
  try {
    return typeof window !== 'undefined' && window.__ELECTRON_CONFIG__ ? 'desktop' : 'web';
  } catch { return 'web'; }
}

function appVersion() {
  try {
    if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) return String(__APP_VERSION__);
  } catch { /* ignore */ }
  return '';
}

/**
 * 创建一通通话的质量跟踪器。所有方法均吞掉异常。
 * @param {{role:'caller'|'callee', callType:'audio'|'video', group:boolean, now?:()=>number}} opts
 */
export function createCallQualityTracker({ role, callType, group = false, now = () => Date.now() }) {
  const st = {
    startAt: null,
    connectedAt: null,
    iceRestarts: 0,
    rttSum: 0, rttCount: 0,
    lostTotal: 0, recvTotal: 0,
    prevByKey: new Map(), // 每条 pc 的累计基线，按差分累加（ICE restart 计数器清零时夹到 0）
    pair: null,
    sent: false,
  };

  const tracker = {
    /** 拨出 / 接听 / 加入群通话的时刻（setupMs 起点）。重复调用以首次为准。 */
    markStart() { if (st.startAt == null) st.startAt = now(); },
    get started() { return st.startAt != null; },
    /** 首次 connected（setupMs 终点、durationSec 起点）。 */
    markConnected() {
      if (st.connectedAt == null) {
        if (st.startAt == null) st.startAt = now();
        st.connectedAt = now();
      }
    },
    markIceRestart() { st.iceRestarts += 1; },
    /**
     * 喂一份 getStats 结果（可来自已有的 2s 采样）。key 区分群通话里的多条 pc。
     */
    ingestStats(report, key = 'pc') {
      try {
        const sel = extractSelectedPair(report);
        if (sel) {
          st.pair = sel;
          if (sel.rttMs != null && sel.rttMs >= 0) { st.rttSum += sel.rttMs; st.rttCount += 1; }
        }
        const { lost, received } = inboundTotals(report);
        const prev = st.prevByKey.get(key) || { lost: 0, received: 0 };
        st.lostTotal += Math.max(0, lost - prev.lost);
        st.recvTotal += Math.max(0, received - prev.received);
        st.prevByKey.set(key, { lost, received });
      } catch { /* ignore */ }
    },
    /** 异步抓一次 pc.getStats()（pc 关闭前调用）；永不 reject。 */
    async sample(pc, key = 'pc') {
      try {
        if (!pc || typeof pc.getStats !== 'function' || pc.connectionState === 'closed') return;
        tracker.ingestStats(await pc.getStats(), key);
      } catch { /* ignore */ }
    },
    buildReport({ endReason } = {}) {
      const end = now();
      const connected = st.connectedAt != null;
      const pair = st.pair || {};
      const totalPk = st.lostTotal + st.recvTotal;
      return {
        role: role === 'callee' ? 'callee' : 'caller',
        callType: callType === 'video' ? 'video' : 'audio',
        group: !!group,
        connected,
        setupMs: connected && st.startAt != null ? Math.max(0, Math.round(st.connectedAt - st.startAt)) : null,
        durationSec: connected ? Math.max(0, Math.round((end - st.connectedAt) / 1000)) : 0,
        endReason: String(endReason || 'unknown').slice(0, 64),
        iceRestarts: st.iceRestarts,
        localCandidateType: pair.localCandidateType ?? null,
        remoteCandidateType: pair.remoteCandidateType ?? null,
        protocol: pair.protocol ?? null,
        relayProtocol: pair.relayProtocol ?? null,
        rttMsAvg: st.rttCount ? Math.round(st.rttSum / st.rttCount) : null,
        packetLossPct: totalPk > 0 ? Math.round((st.lostTotal / totalPk) * 10000) / 100 : null,
        platform: detectPlatform(),
        appVersion: appVersion(),
      };
    },
    /**
     * 上报（每通只发一次）。未开始（如旁观设备未接听）或无 callId 时不发。
     * 发送放到下一个宏任务，绝不阻塞挂断；失败（含旧后端 404）静默。
     */
    send(callId, { endReason } = {}) {
      try {
        if (st.sent || !callId || st.startAt == null) return false;
        st.sent = true;
        const payload = tracker.buildReport({ endReason });
        setTimeout(() => {
          try {
            // 不设 skipRetry：带 skipRetry 的 401 不走 refresh，会被 AuthContext 当成会话失效直接登出
            const r = axios.post(`/api/calls/${encodeURIComponent(callId)}/report`, payload, { timeout: 10000 });
            r?.catch?.(() => {});
          } catch { /* ignore */ }
        }, 0);
        return true;
      } catch { return false; }
    },
  };
  return tracker;
}
