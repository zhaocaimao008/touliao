import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn(() => Promise.resolve({ status: 204 }));
vi.mock('axios', () => ({ default: { post: (...a) => post(...a) } }));

const { createCallQualityTracker, extractSelectedPair } = await import('./callQualityReport.js');

function report(entries) {
  return new Map(entries.map(e => [e.id, e]));
}

const relayStats = (lost, received, rtt = 0.12) => report([
  { id: 'T1', type: 'transport', selectedCandidatePairId: 'CP1' },
  { id: 'CP1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1', currentRoundTripTime: rtt, state: 'succeeded', nominated: true },
  { id: 'CP2', type: 'candidate-pair', localCandidateId: 'L2', remoteCandidateId: 'R1', currentRoundTripTime: 0.5, state: 'failed' },
  { id: 'L1', type: 'local-candidate', candidateType: 'relay', protocol: 'udp', relayProtocol: 'tls' },
  { id: 'L2', type: 'local-candidate', candidateType: 'host', protocol: 'udp' },
  { id: 'R1', type: 'remote-candidate', candidateType: 'srflx', protocol: 'udp' },
  { id: 'IA', type: 'inbound-rtp', kind: 'audio', packetsLost: lost, packetsReceived: received },
]);

describe('callQualityReport', () => {
  let now;
  beforeEach(() => { vi.useFakeTimers(); post.mockClear(); now = 1000; });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('经 transport.selectedCandidatePairId 解析选中候选对', () => {
    expect(extractSelectedPair(relayStats(0, 0))).toEqual({
      localCandidateType: 'relay', remoteCandidateType: 'srflx', protocol: 'udp', relayProtocol: 'tls', rttMs: 120,
    });
  });

  it('无 transport 时回退到 selected / nominated+succeeded 的 candidate-pair；无数据返回 null', () => {
    const r = report([
      { id: 'CP', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', selected: true },
      { id: 'L', type: 'local-candidate', candidateType: 'host', protocol: 'tcp' },
      { id: 'R', type: 'remote-candidate', candidateType: 'prflx' },
    ]);
    expect(extractSelectedPair(r)).toMatchObject({ localCandidateType: 'host', remoteCandidateType: 'prflx', protocol: 'tcp', relayProtocol: null });
    expect(extractSelectedPair(new Map())).toBeNull();
    expect(extractSelectedPair(null)).toBeNull();
  });

  it('构造符合契约的上报：setupMs / 时长 / RTT 均值 / 丢包差分 / ICE restart 计数', async () => {
    const tracker = createCallQualityTracker({ role: 'caller', callType: 'video', group: false, now: () => now });
    tracker.markStart();
    now = 3500; tracker.markConnected();
    tracker.ingestStats(relayStats(0, 100, 0.1));
    tracker.ingestStats(relayStats(10, 190, 0.2));   // 窗口内 +10 丢 +90 收
    tracker.markIceRestart();
    now = 3500 + 61_000;
    expect(tracker.send('call-1', { endReason: 'hangup' })).toBe(true);
    expect(post).not.toHaveBeenCalled();             // 不在挂断调用栈里同步发出
    await vi.runAllTimersAsync();
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/api/calls/call-1/report');
    expect(body).toMatchObject({
      role: 'caller', callType: 'video', group: false, connected: true,
      setupMs: 2500, durationSec: 61, endReason: 'hangup', iceRestarts: 1,
      localCandidateType: 'relay', remoteCandidateType: 'srflx', protocol: 'udp', relayProtocol: 'tls',
      rttMsAvg: 150, packetLossPct: 5, platform: 'web',
    });
    expect(typeof body.appVersion).toBe('string');
  });

  it('未接通：connected=false、setupMs=null、时长 0', async () => {
    const tracker = createCallQualityTracker({ role: 'caller', callType: 'audio', now: () => now });
    tracker.markStart();
    tracker.send('c2', { endReason: 'timeout' });
    await vi.runAllTimersAsync();
    expect(post.mock.calls[0][1]).toMatchObject({ connected: false, setupMs: null, durationSec: 0, rttMsAvg: null, packetLossPct: null, localCandidateType: null });
  });

  it('只发一次；未开始（旁观设备未接听）或无 callId 不发', async () => {
    const idle = createCallQualityTracker({ role: 'callee', callType: 'audio' });
    expect(idle.send('c3')).toBe(false);
    const t = createCallQualityTracker({ role: 'callee', callType: 'audio' });
    t.markStart();
    expect(t.send(null)).toBe(false);
    expect(t.send('c4')).toBe(true);
    expect(t.send('c4')).toBe(false);
    await vi.runAllTimersAsync();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('Electron 下 platform=desktop；请求失败（旧后端 404）与 getStats 抛错均不外抛', async () => {
    vi.stubGlobal('window', { __ELECTRON_CONFIG__: {} });
    post.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('404'), { response: { status: 404 } })));
    const t = createCallQualityTracker({ role: 'caller', callType: 'audio' });
    t.markStart();
    await expect(t.sample({ getStats: () => Promise.reject(new Error('closed')) })).resolves.toBeUndefined();
    t.ingestStats({ forEach() { throw new Error('bad'); } });
    t.send('c5');
    await vi.runAllTimersAsync();
    expect(post.mock.calls[0][1].platform).toBe('desktop');
  });
});
