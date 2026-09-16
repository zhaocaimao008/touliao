import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { showToast } from '../utils/toast';
import { installPrewarm, startRingback as toneRingback, stopTone, playConnectedTone } from '../utils/callTones';
import { tuneSdpForWeakNetwork } from '../utils/sdpTune';
import { videoConstraints, capVideoBitrate, preferH264 } from '../utils/callMedia';
import { useI18n } from '../contexts/I18nContext';
import { matchesGroupStartAttempt } from '../utils/callSignaling';
import { stopStream } from '../utils/callLifecycle';
import './GroupCallModal.css';
import useCallAudioOutput from '../hooks/useCallAudioOutput';
import useCallAudioLevels from '../hooks/useCallAudioLevels';

installPrewarm();

// 仅在拉取 /api/turn/credentials 失败时兜底
const FALLBACK_ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
] };

async function fetchIceConfig() {
  try {
    const { data } = await axios.get('/api/turn/credentials');
    if (data && Array.isArray(data.iceServers) && data.iceServers.length) return { iceServers: data.iceServers };
  } catch { /* 兜底 */ }
  return FALLBACK_ICE;
}

// A-3（2026-09-05）：mesh 群通话每条 pc 的发送码率上限按当前人数降档——N 路同时编码
// 共享同一份 CPU，人越多每路预算必须越低，否则全员互相拖垮：
//   ≤2 人 2.5M（与 1v1 默认一致）/ 3 人 1.6M / 4 人 1.2M / ≥5 人 1.0M；
//   ≥4 人另叠加 scaleResolutionDownBy=2（见 capVideoBitrate 的 degrade 参数）降编码负载。
function capForPeerCount(n) {
  if (n <= 2) return 2_500_000;
  if (n === 3) return 1_600_000;
  if (n === 4) return 1_200_000;
  return 1_000_000;
}

// ── Hook: 响应式宫格列数 ──────────────────────────────────────
function useResponsiveGrid(tileCount) {
  const [cols, setCols] = useState(() => {
    if (tileCount <= 1) return 1;
    if (tileCount <= 4) return 2;
    return 3;
  });
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (tileCount <= 1) setCols(1);
      else if (tileCount <= 2) setCols(w < 480 ? 1 : 2);
      else if (tileCount <= 4) setCols(2);
      else setCols(w < 640 ? 2 : 3);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [tileCount]);
  return cols;
}

// ── Hook: Focus Trap（弹窗内 Tab 循环） ──────────────────────
function useFocusTrap(open) {
  const containerRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;
    const focusableSel = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const focusable = () => [...container.querySelectorAll(focusableSel)].filter(el => el.getClientRects().length > 0);
    const prevFocus = document.activeElement;
    const focusFirst = () => {
      const els = focusable();
      if (els.length) els[0].focus();
    };
    focusFirst();
    const handler = (e) => {
      if (e.key !== 'Tab') return;
      const els = focusable();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    container.addEventListener('keydown', handler);
    return () => {
      container.removeEventListener('keydown', handler);
      prevFocus?.focus();
    };
  }, [open]);
  return containerRef;
}

// ── Hook: WebRTC 群通话信令与连接管理 ──────────────────────────
function useGroupCallWebRTC({ socket, user: _user, session, nameOf: _nameOf, onClose }) {
  const { t } = useI18n();
  const { mode, conversationId, type } = session;
  const isVideo = type === 'video';

  const [callId, setCallId] = useState(session.callId || null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  // 本端是否持有视频轨；初始化失败时清零，成功重试后按实际轨道更新。
  const [selfHasVideo, setSelfHasVideo] = useState(isVideo);
  // B-1：远端成员是否送来过视频轨（peerId → true）。语音会话里对端升级后靠 ontrack
  // 自然置位，Tile 据此切视频布局，无需额外信令。
  const [remoteVideo, setRemoteVideo] = useState({});
  const [remoteStreams, setRemoteStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [status, setStatus] = useState('preparing');
  const [peerStates, setPeerStates] = useState({});
  const [mediaError, setMediaError] = useState(false);
  const [connectedAt, setConnectedAt] = useState(null);
  const mediaBusyRef = useRef(false);
  const joiningTimerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const localStreamRef = useRef(null);
  const selfHasVideoRef = useRef(isVideo);
  const upgradingRef = useRef(false);        // 防升级按钮连点重复 gUM/重协商
  const upgradeStreamRef = useRef(null);     // 升级取到的视频流引用，防 GC 停轨（对齐 1v1 videoAddStreamRef）
  const iceCfgRef = useRef(FALLBACK_ICE);
  const pcsRef = useRef(new Map());
  const remoteSetRef = useRef(new Set());
  const pendingIceRef = useRef(new Map());
  const callIdRef = useRef(session.callId || null);
  // Q06 全修：group_call:resume 现在必须证明持有 group_call:started/peers 签发的
  // resumeToken——光凭 callId+userId 不再够，否则同账号旁观设备能在宽限期内抢注。
  const resumeTokenRef = useRef(null);
  const reactAttemptId = useId();
  const startRequestIdRef = useRef(mode === 'start' ? `group-start-${reactAttemptId}` : null);
  const closedRef = useRef(false);
  const participatingRef = useRef(false);
  // ICE restart 自愈(网络切换):peerId → 重启计数 / {debounce, recover} 定时器。
  // 与 1:1 同策略:disconnected 3s 防抖 → restartIce → 15s 窗口 → 最多 3 次 → removePeer。
  const peerRestartCountRef = useRef(new Map());
  const peerRestartTimersRef = useRef(new Map());
  const ICE_RESTART_DEBOUNCE_MS = 3000;
  const ICE_RESTART_WINDOW_MS   = 15000;
  const ICE_RESTART_MAX         = 3;

  const syncPeerStatus = useCallback(() => {
    if (closedRef.current) return;
    const states = Object.fromEntries([...pcsRef.current].map(([id, pc]) => [id, pc.connectionState]));
    setPeerStates(states);
    const values = Object.values(states);
    if (values.includes('connected')) {
      setStatus('connected');
      setConnectedAt(prev => prev ?? Date.now());
    } else if (values.some(s => s === 'disconnected' || s === 'failed')) setStatus('reconnecting');
    else if (values.length) setStatus('connecting');
    else if (participatingRef.current) setStatus('waiting');
  }, []);

  // A-3：按当前已连接 peer 数对全部已连接 pc 重放码率/降档。人数与施加对象都只算
  // 已连接的——未协商完的 sender 上 setParameters 在部分浏览器会抛错（静默即可，但
  // 没必要），且连上才真正占编码资源。触发点：新 peer connected / peer 离开（removePeer）。
  const reapplyCaps = useCallback(() => {
    let n = 0;
    pcsRef.current.forEach(pc => { if (pc.connectionState === 'connected') n += 1; });
    const maxBps = capForPeerCount(n);
    const degrade = n >= 4;
    pcsRef.current.forEach(pc => {
      if (pc.connectionState === 'connected') capVideoBitrate(pc, maxBps, degrade);
    });
  }, []);

  const removePeer = useCallback((peerId) => {
    const pc = pcsRef.current.get(peerId);
    if (pc) {
      pc.onconnectionstatechange = null; pc.ontrack = null; pc.onicecandidate = null;
      pcsRef.current.delete(peerId);
      try { pc.close(); } catch { /* 连接已关闭 */ }
    }
    const timers = peerRestartTimersRef.current.get(peerId);
    clearTimeout(timers?.debounce); clearTimeout(timers?.recover);
    peerRestartTimersRef.current.delete(peerId);
    peerRestartCountRef.current.delete(peerId);
    remoteSetRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    setRemoteStreams(prev => {
      if (!(peerId in prev)) return prev;
      const n = { ...prev }; delete n[peerId]; return n;
    });
    setRemoteVideo(prev => {
      if (!(peerId in prev)) return prev;
      const n = { ...prev }; delete n[peerId]; return n;
    });
    reapplyCaps();   // A-3：人数减少 → 剩余 peer 的码率/降档按新人数重放（撤销降档也靠它）
    syncPeerStatus();
  }, [reapplyCaps, syncPeerStatus]);

  const drainIce = useCallback((peerId) => {
    const pc = pcsRef.current.get(peerId);
    const pending = pendingIceRef.current.get(peerId);
    if (pc && pending) {
      pending.forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
      pendingIceRef.current.delete(peerId);
    }
  }, []);

  const createPC = useCallback((peerId) => {
    if (closedRef.current) return null;
    if (pcsRef.current.has(peerId)) return pcsRef.current.get(peerId);
    const pc = new RTCPeerConnection(iceCfgRef.current);
    pcsRef.current.set(peerId, pc);
    syncPeerStatus();
    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket?.emit('group_call:ice', { callId: callIdRef.current, to: peerId, candidate });
    };
    pc.ontrack = (e) => {
      if (closedRef.current || pcsRef.current.get(peerId) !== pc) return;
      const stream = e.streams[0] || new MediaStream([e.track]);
      setRemoteStreams(prev => (prev[peerId] === stream ? prev : { ...prev, [peerId]: stream }));
      // 远端语音升级视频后按收到的轨道切换布局。
      if (e.track.kind === 'video') setRemoteVideo(prev => (prev[peerId] ? prev : { ...prev, [peerId]: true }));
    };
    // ICE restart 状态机(与 1:1 同策略):disconnected 3s 防抖 → restartIce → 15s 窗口
    // → 最多 3 次 → removePeer。信令复用 group_call:offer/answer/ice,后端零改动。
    const tryPeerRestart = async () => {
      if (closedRef.current || pcsRef.current.get(peerId) !== pc) return;
      const count = peerRestartCountRef.current.get(peerId) || 0;
      if (count >= ICE_RESTART_MAX) { removePeer(peerId); return; }
      peerRestartCountRef.current.set(peerId, count + 1);
      pc.restartIce();
      // restartIce() 只打标记，必须实际重协商 offer 对方才会重新打通（对齐 1:1/iOS/Android 修复）
      try {
        const offer = await pc.createOffer();
        if (closedRef.current || pcsRef.current.get(peerId) !== pc) return;
        const tunedOffer = tuneSdpForWeakNetwork(offer.sdp);
        await pc.setLocalDescription(new RTCSessionDescription({ type: offer.type, sdp: tunedOffer }));
        if (closedRef.current || pcsRef.current.get(peerId) !== pc) return;
        socket?.emit('group_call:offer', { callId: callIdRef.current, to: peerId, offer: { type: offer.type, sdp: tunedOffer } });
      } catch (err) {
        console.error('[groupCall] ICE restart 重协商失败:', err);
      }
      if (closedRef.current || pcsRef.current.get(peerId) !== pc) return;
      const timers = peerRestartTimersRef.current.get(peerId) || {};
      clearTimeout(timers.recover);
      timers.recover = setTimeout(() => {
        const cur = pcsRef.current.get(peerId);
        const st = cur?.connectionState;
        if (st === 'disconnected' || st === 'failed') tryPeerRestart();
        else peerRestartTimersRef.current.delete(peerId);
      }, ICE_RESTART_WINDOW_MS);
      peerRestartTimersRef.current.set(peerId, timers);
    };
    pc.onconnectionstatechange = () => {
      if (closedRef.current || pcsRef.current.get(peerId) !== pc) return;
      syncPeerStatus();
      const s = pc.connectionState;
      if (s === 'connected') {
        // restart 后恢复:清定时器 + 计数清零(可反复自愈)
        const timers = peerRestartTimersRef.current.get(peerId);
        if (timers) { clearTimeout(timers.debounce); clearTimeout(timers.recover); peerRestartTimersRef.current.delete(peerId); }
        peerRestartCountRef.current.delete(peerId);
        reapplyCaps();   // A-3：本 pc 刚转 connected，按最新人数对全部已连接 pc（含本条）重放码率/降档
      } else if (s === 'disconnected') {
        // 短时探测间隙:防抖后再重启,避免无谓重协商
        const timers = peerRestartTimersRef.current.get(peerId) || {};
        clearTimeout(timers.debounce);
        timers.debounce = setTimeout(() => {
          clearTimeout(peerRestartTimersRef.current.get(peerId)?.recover);
          tryPeerRestart();
        }, ICE_RESTART_DEBOUNCE_MS);
        peerRestartTimersRef.current.set(peerId, timers);
      } else if (s === 'failed') {
        const timers = peerRestartTimersRef.current.get(peerId);
        const count = peerRestartCountRef.current.get(peerId) || 0;
        if (count === 0 && !timers?.recover) tryPeerRestart();   // 首次 failed:给一次 restart 机会
        else if (!timers?.recover) removePeer(peerId);           // 已重启过且非窗口期 → 移除
        // 窗口进行中:交给窗口到期后的 tryPeerRestart 判定
      } else if (s === 'closed') {
        removePeer(peerId);
      }
    };
    return pc;
  }, [socket, removePeer, reapplyCaps, syncPeerStatus]);

  // 对单个 peer 建 offer 并发送（含 H264 偏好 + 弱网调优）。onPeerJoined（新成员入会）
  // 与 B-1 语音→视频升级的逐 peer 重协商共用；mesh 无集中媒体单元，每 peer 独立一份
  // offer/answer。signalingState 非 stable（如撞上 ICE restart 重协商窗口）时跳过——
  // 轨已 addTrack，该 peer 下一次协商自然带上。
  const sendOfferToPeer = useCallback(async (peerId) => {
    const pc = pcsRef.current.get(peerId);
    if (closedRef.current || !pc || pc.signalingState !== 'stable') return;
    await preferH264(pc);   // A-2：addTrack 后、createOffer 前设 H264 优先（setCodecPreferences 须先于协商）
    if (closedRef.current || pcsRef.current.get(peerId) !== pc) return;
    const offer = await pc.createOffer();
    if (closedRef.current || pcsRef.current.get(peerId) !== pc) return;
    const tunedOffer = tuneSdpForWeakNetwork(offer.sdp);
    await pc.setLocalDescription(new RTCSessionDescription({ type: offer.type, sdp: tunedOffer }));
    if (closedRef.current || pcsRef.current.get(peerId) !== pc) return;
    socket?.emit('group_call:offer', { callId: callIdRef.current, to: peerId, offer: { type: offer.type, sdp: tunedOffer } });
  }, [socket]);

  const cleanup = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    clearTimeout(joiningTimerRef.current);
    participatingRef.current = false;
    if (callIdRef.current) socket?.emit('group_call:leave', { callId: callIdRef.current });
    pcsRef.current.forEach(pc => { try { pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null; pc.close(); } catch { /* 连接已关闭 */ } });
    pcsRef.current.clear();
    peerRestartTimersRef.current.forEach(t => { clearTimeout(t.debounce); clearTimeout(t.recover); });
    peerRestartTimersRef.current.clear();
    peerRestartCountRef.current.clear();
    stopStream(localStreamRef.current);
    stopStream(upgradeStreamRef.current);
    localStreamRef.current = null;
    upgradeStreamRef.current = null;
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const resumeParticipatingCall = () => {
      if (participatingRef.current && callIdRef.current && !closedRef.current) {
        socket.emit('group_call:resume', { callId: callIdRef.current, resumeToken: resumeTokenRef.current });
      }
    };
    socket.on('connect', resumeParticipatingCall);
    return () => socket.off('connect', resumeParticipatingCall);
  }, [socket]);

  const hangup = useCallback(() => {
    if (closedRef.current) return;
    cleanup();
    setStatus('ended');
    onCloseRef.current?.();
  }, [cleanup]);

  const toggleMute = useCallback(() => {
    if (closedRef.current || !localStreamRef.current?.getAudioTracks().some(t => t.readyState === 'live')) return;
    const on = !muted; setMuted(on);
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !on; });
    return on;
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const off = !cameraOff; setCameraOff(off);
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !off; });
    return off;
  }, [cameraOff]);

  // B-1：语音加入者升级视频——gUM 取视频轨并入 localStream（此后新 peer 的 createPC
  // 会自动 addTrack），再对 pcsRef 里每条已建立 pc addTrack 并逐个独立重协商（mesh 每
  // peer 一份 offer/answer，走群既有发 offer 路径 sendOfferToPeer）。reapplyCaps 使
  // 人数降档上限对新视频 sender 生效（capVideoBitrate 支持任意 pc）。失败（权限拒绝/
  // 设备占用）提示并保持语音。反向（升级后关摄像头）走上面现有 toggleCamera，不改。
  const upgradeToVideo = useCallback(async () => {
    if (closedRef.current || !localStreamRef.current || selfHasVideoRef.current || upgradingRef.current) return;
    upgradingRef.current = true;
    try {
      const vs = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(true), audio: false });
      if (closedRef.current) { stopStream(vs); return; }
      const track = vs.getVideoTracks()[0];
      if (!track) { stopStream(vs); return; }
      upgradeStreamRef.current = vs;   // 持有引用防 GC 停轨
      const ls = localStreamRef.current;
      if (!ls) {
        localStreamRef.current = vs; setLocalStream(vs);
      } else {
        try { ls.addTrack(track); } catch { /* 已存在 */ }
      }
      selfHasVideoRef.current = true;
      setSelfHasVideo(true);
      setCameraOff(false);
      for (const [pid, pc] of pcsRef.current) {
        if (closedRef.current) { stopStream(vs); return; }
        try { pc.addTrack(track, localStreamRef.current); } catch { /* 该 pc 已带此轨 */ }
        await sendOfferToPeer(pid);
      }
      reapplyCaps();
    } catch (e) {
      if (closedRef.current) return;
      console.error('[groupCall] 升级视频失败:', e);
      showToast(t('call.cameraOpenFailed'), 'error');
    } finally {
      upgradingRef.current = false;
    }
  }, [sendOfferToPeer, reapplyCaps, t]);

  const peerIds = Object.keys(peerStates);
  const tileCount = peerIds.length + 1;

  // 未拿到麦克风时不入会；用户明确重试后再请求权限。
  const initializeMedia = useCallback(async () => {
    if (closedRef.current || mediaBusyRef.current || participatingRef.current) return;
    mediaBusyRef.current = true;
    setStatus('preparing');
    setMediaError(false);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoConstraints(isVideo) });
      if (closedRef.current) { stopStream(stream); return; }
      if (!stream.getAudioTracks().some(track => track.readyState === 'live')) throw new Error('No microphone track');
      localStreamRef.current = stream;
      setLocalStream(stream);
      selfHasVideoRef.current = stream.getVideoTracks().length > 0;
      setSelfHasVideo(selfHasVideoRef.current);
      iceCfgRef.current = await fetchIceConfig();
      if (closedRef.current) { stopStream(stream); return; }
      if (!socket || socket.connected === false) throw new Error('Signaling offline');
      setStatus('joining');
      joiningTimerRef.current = setTimeout(() => {
        if (!closedRef.current && !participatingRef.current) {
          showToast(t('groupCall.joinTimeout'), 'error');
          hangup();
        }
      }, 20000);
      if (mode === 'start') socket.emit('group_call:start', { conversationId, type, requestId: startRequestIdRef.current });
      else socket.emit('group_call:join', { callId: callIdRef.current });
    } catch (error) {
      stopStream(stream);
      if (closedRef.current) return;
      localStreamRef.current = null;
      setLocalStream(null);
      setSelfHasVideo(false);
      selfHasVideoRef.current = false;
      setMediaError(true);
      setStatus('media-error');
      console.warn('[groupCall] 初始化失败:', error);
    } finally {
      mediaBusyRef.current = false;
    }
  }, [socket, isVideo, mode, conversationId, type, hangup, t]);

  useEffect(() => {
    // Queue startup so acquisition only runs for a still-mounted session.
    Promise.resolve().then(initializeMedia);
    return cleanup;
    // Session is mounted once; retry is an explicit user action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 信令事件 ──────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onStarted = ({ callId: cid, requestId, resumeToken }) => {
      if (closedRef.current || !cid || !matchesGroupStartAttempt({ requestId }, startRequestIdRef.current)) return;
      if (callIdRef.current && cid !== callIdRef.current) return;
      participatingRef.current = true;
      clearTimeout(joiningTimerRef.current);
      callIdRef.current = cid; setCallId(cid);
      syncPeerStatus();
      resumeTokenRef.current = resumeToken;
    };
    const onPeers = async ({ callId: cid, peers, resumeToken }) => {
      if (closedRef.current || !cid || !callIdRef.current || cid !== callIdRef.current) return;
      participatingRef.current = true;
      clearTimeout(joiningTimerRef.current);
      callIdRef.current = cid; setCallId(cid);
      syncPeerStatus();
      resumeTokenRef.current = resumeToken;
      peers.forEach(pid => createPC(pid));
    };
    const onPeerJoined = async ({ callId: cid, userId: pid }) => {
      if (closedRef.current || cid !== callIdRef.current) return;
      createPC(pid);
      try { await sendOfferToPeer(pid); }
      catch (error) { if (!closedRef.current) { console.warn('[groupCall] 建连失败:', error); removePeer(pid); } }
    };
    const onOffer = async ({ callId: cid, from, offer }) => {
      if (closedRef.current || cid !== callIdRef.current) return;
      const pc = createPC(from);
      const current = () => !closedRef.current && pcsRef.current.get(from) === pc;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        if (!current()) return;
        remoteSetRef.current.add(from); drainIce(from);
        await preferH264(pc);
        if (!current()) return;
        const answer = await pc.createAnswer();
        if (!current()) return;
        const tunedAnswer = tuneSdpForWeakNetwork(answer.sdp);
        await pc.setLocalDescription(new RTCSessionDescription({ type: answer.type, sdp: tunedAnswer }));
        if (!current()) return;
        socket.emit('group_call:answer', { callId: callIdRef.current, to: from, answer: { type: answer.type, sdp: tunedAnswer } });
      } catch (error) {
        if (current()) { console.warn('[groupCall] 接收 offer 失败:', error); removePeer(from); }
      }
    };
    const onAnswer = async ({ callId: cid, from, answer }) => {
      if (closedRef.current || cid !== callIdRef.current) return;
      const pc = pcsRef.current.get(from);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        if (closedRef.current || pcsRef.current.get(from) !== pc) return;
        remoteSetRef.current.add(from); drainIce(from);
      } catch (error) {
        if (!closedRef.current && pcsRef.current.get(from) === pc) {
          console.warn('[groupCall] 接收 answer 失败:', error); removePeer(from);
        }
      }
    };
    const onIce = ({ callId: cid, from, candidate }) => {
      if (closedRef.current || cid !== callIdRef.current) return;
      const pc = pcsRef.current.get(from);
      if (pc && remoteSetRef.current.has(from)) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        const arr = pendingIceRef.current.get(from) || [];
        arr.push(candidate);
        pendingIceRef.current.set(from, arr);
      }
    };
    const onPeerLeft = ({ callId: cid, userId: pid }) => {
      if (cid === callIdRef.current) removePeer(pid);
    };
    const onError = ({ reason, callId: cid, requestId }) => {
      if (closedRef.current) return;
      if (requestId) {
        if (!matchesGroupStartAttempt({ requestId }, startRequestIdRef.current)) return;
      } else if (!cid || cid !== callIdRef.current) return;
      const msg = {
        busy: t('groupCall.errorBusy'),
        active_call: t('groupCall.errorActiveCall'),
        not_group: t('groupCall.errorNotGroup'),
        not_found: t('call.callEnded'),
        full: t('groupCall.errorFull'),
        voice_disabled: t('groupCall.errorVoiceDisabled'),
        video_disabled: t('groupCall.errorVideoDisabled'),
      }[reason] || t('groupCall.errorGeneric');
      showToast(msg, 'error');
      hangup();
    };
    // 服务端强制结束（如超过时长上限）：提示并关闭界面
    const onEnded = ({ callId: cid, reason }) => {
      if (closedRef.current || !cid || cid !== callIdRef.current) return;
      showToast(reason === 'timeout' ? t('groupCall.endedTimeout') : t('call.callEnded'), 'info');
      hangup();
    };
    socket.on('group_call:started', onStarted);
    socket.on('group_call:peers', onPeers);
    socket.on('group_call:peer_joined', onPeerJoined);
    socket.on('group_call:offer', onOffer);
    socket.on('group_call:answer', onAnswer);
    socket.on('group_call:ice', onIce);
    socket.on('group_call:peer_left', onPeerLeft);
    socket.on('group_call:error', onError);
    socket.on('group_call:ended', onEnded);
    return () => {
      socket.off('group_call:started', onStarted);
      socket.off('group_call:peers', onPeers);
      socket.off('group_call:peer_joined', onPeerJoined);
      socket.off('group_call:offer', onOffer);
      socket.off('group_call:answer', onAnswer);
      socket.off('group_call:ice', onIce);
      socket.off('group_call:peer_left', onPeerLeft);
      socket.off('group_call:error', onError);
      socket.off('group_call:ended', onEnded);
    };
  }, [socket, createPC, drainIce, removePeer, hangup, sendOfferToPeer, syncPeerStatus, t]);

  return {
    callId, muted, cameraOff, selfHasVideo, remoteVideo, remoteStreams, localStream, status,
    peerIds, peerStates, tileCount, localStreamRef, isVideo, mediaError, connectedAt, initializeMedia,
    toggleMute, toggleCamera, upgradeToVideo, hangup, cleanup,
  };
}

// ════════════════════════════════════════════════════════════════
//  主组件
// ════════════════════════════════════════════════════════════════
export default function GroupCallModal({ socket, user, session, nameOf, onClose }) {
  const { t } = useI18n();
  const webrtc = useGroupCallWebRTC({ socket, user, session, nameOf, onClose });
  const [members, setMembers] = useState({});
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    axios.get(`/api/messages/conversation/${session.conversationId}/members`, { signal: controller.signal })
      .then(({ data }) => {
        if (active && Array.isArray(data)) setMembers(Object.fromEntries(data.map(member => [member.id, { name: member.username, avatar: member.avatar }])));
      }).catch(() => {});
    return () => { active = false; controller.abort(); };
  }, [session.conversationId]);
  const cols = useResponsiveGrid(webrtc.tileCount);
  const [minimized, setMinimized] = useState(false);
  const containerRef = useFocusTrap(!minimized);
  const toneRef = useRef(null); // 回铃音循环句柄 { stop }
  const { muted, cameraOff, remoteStreams, remoteVideo, localStream, status, isVideo, selfHasVideo, peerIds, tileCount } = webrtc;

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!webrtc.connectedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - webrtc.connectedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [webrtc.connectedAt]);
  const waiting = session.mode === 'start' && status === 'waiting' && !webrtc.connectedAt;
  useEffect(() => {
    if (waiting) { stopTone(); toneRef.current = toneRingback(); }
    if (status === 'connected') playConnectedTone();
    return () => { toneRef.current?.stop(); toneRef.current = null; };
  }, [waiting, status]);

  const statusText = {
    preparing: t('groupCall.statusPreparing'),
    'media-error': t('groupCall.statusMediaError'),
    joining: t('groupCall.statusJoining'),
    waiting: t('groupCall.statusWaitingOthers'),
    connecting: t('call.connecting'),
    reconnecting: t('groupCall.statusReconnecting'),
    connected: t('groupCall.statusConnected'),
    ended: t('call.callEnded'),
  }[status];
  const timerText = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const mediaReady = !!localStream && !webrtc.mediaError && status !== 'ended';
  const output = useCallAudioOutput(mediaReady);
  const levels = useCallAudioLevels(localStream, remoteStreams);
  const [volumes, setVolumes] = useState({});
  const [blockedPeers, setBlockedPeers] = useState({});
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const onAudioBlocked = useCallback((id, blocked) => {
    setBlockedPeers(prev => prev[id] === blocked ? prev : { ...prev, [id]: blocked });
  }, []);
  const audioBlocked = peerIds.some(id => blockedPeers[id]);
  const title = t('groupCall.headerTemplate')
    .replace('{type}', isVideo ? t('groupCall.videoCallLabel') : t('groupCall.voiceCallLabel'))
    .replace('{count}', tileCount);
  const names = Object.fromEntries(peerIds.map(id => [id, nameOf?.(id) || members[id] || { name: t('groupCall.member') }]));
  const speakingNames = [levels.self?.speaking && !muted ? t('home.tab.me') : null,
    ...peerIds.filter(id => levels[id]?.speaking).map(id => names[id].name)].filter(Boolean);
  const speakerText = speakingNames.length ? t('groupCall.speakingNames').replace('{names}', speakingNames.join('、')) : '';
  const [floating, setFloating] = useState(null);
  const dragRef = useRef(null);
  const miniRef = useRef(null);
  useEffect(() => {
    const clamp = () => setFloating(position => position ? {
      x: Math.max(8, Math.min(position.x, window.innerWidth - (miniRef.current?.offsetWidth || 280) - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - (miniRef.current?.offsetHeight || 140) - 8)),
    } : position);
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);
  const beginDrag = event => {
    if (event.button !== 0) return;
    const bounds = miniRef.current.getBoundingClientRect();
    dragRef.current = { pointer: event.pointerId, x: event.clientX - bounds.x, y: event.clientY - bounds.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = event => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointer) return;
    const bounds = miniRef.current.getBoundingClientRect();
    setFloating({ x: Math.max(8, Math.min(event.clientX - drag.x, innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(event.clientY - drag.y, innerHeight - bounds.height - 8)) });
  };


  return (
    <>
    {/* These players stay mounted across minimize/restore and conversation navigation. */}
    <div className="gcm-audio-players" aria-hidden="true">
      {peerIds.map(id => <RemoteAudio key={id} peerId={id} stream={remoteStreams[id]}
        volume={volumes[id] ?? 1} register={output.register} onBlocked={onAudioBlocked} />)}
    </div>
    <div ref={containerRef} hidden={minimized} role="dialog" aria-label={t('groupCall.title')} aria-modal="true" className={`gcm-dialog${tileCount >= 5 ? ' gcm-dialog--compact' : ''}`}>
      <header className="gcm-header">
        <h2>{title}</h2>
        <button type="button" className="gcm-minimize" aria-label={t('call.minimize')} title={t('call.minimize')}
          onClick={() => setMinimized(true)}><CallIcon kind="minimize" /></button>
        <p role="status" className={`gcm-status gcm-status--${status}`}>
          <span className="gcm-status-dot" aria-hidden="true" />{statusText}
          {webrtc.connectedAt && <span className="gcm-timer" aria-label={t('groupCall.duration')}>{timerText}</span>}
        </p>
      </header>
      {webrtc.mediaError && (
        <div className="gcm-error" role="alert">
          <span>{t('groupCall.mediaError')}</span>
          <button type="button" onClick={webrtc.initializeMedia}>{t('common.retry')}</button>
        </div>
      )}
      {audioBlocked && <div className="gcm-error" role="status"><span>{t('call.tapToRestoreAudio')}</span>
        <button type="button" onClick={() => window.dispatchEvent(new Event('call:resume-audio'))}>{t('groupCall.restoreSound')}</button></div>}
      <p className="gcm-speakers" aria-live="off" title={speakerText}>{speakerText || t('groupCall.speechHint')}</p>
      <div className="gcm-stage">
        <div className="gcm-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          <Tile stream={localStream} muted isVideo={selfHasVideo && !cameraOff}
            info={{ name: t('home.tab.me'), avatar: user?.avatar }} self level={muted ? null : levels.self}
            badge={!mediaReady ? t('groupCall.micUnavailable') : muted ? t('groupCall.micMuted') : t('groupCall.micOn')} />
          {peerIds.map(pid => (
            <Tile key={pid} streamForRef={remoteStreams[pid]} isVideo={isVideo || !!remoteVideo[pid]}
              info={names[pid]} level={levels[pid]}
              badge={webrtc.peerStates[pid] === 'connected' ? t('groupCall.statusConnected')
                : ['failed', 'disconnected'].includes(webrtc.peerStates[pid]) ? t('groupCall.statusReconnecting') : t('call.connecting')} />
          ))}
        </div>
      </div>
      {showAudioSettings && <section className="gcm-audio-settings" aria-label={t('groupCall.audioSettings')}>
        <div className="gcm-output-row">
          {output.supported ? <label>
            <span>{t('call.outputDevice')}</span>
            <select value={output.selected} disabled={output.pending} onChange={e => output.select(e.target.value)}>
              <option value="">{t('groupCall.systemOutput')}</option>
              {output.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>
                {device.label || t('groupCall.outputNumber').replace('{number}', index + 1)}
              </option>)}
            </select>
          </label> : <p>{t('groupCall.outputUnsupported')}</p>}
          {output.canChoose && <button type="button" disabled={output.pending} onClick={output.choose}>{t('groupCall.chooseOutput')}</button>}
        </div>
        {output.error && <p className="gcm-settings-error" role="alert">{t('groupCall.outputFailed')}</p>}
        {output.unplugged && <p role="status">{t('groupCall.outputDisconnected')}</p>}
        {peerIds.length > 0 && <fieldset className="gcm-volumes"><legend>{t('groupCall.memberVolumes')}</legend>
          {peerIds.map(id => <label key={id} className="gcm-volume">
            <span title={names[id].name}>{names[id].name}</span>
            <input type="range" min="0" max="100" step="5" value={Math.round((volumes[id] ?? 1) * 100)}
              aria-label={t('groupCall.memberVolume').replace('{name}', names[id].name)}
              onChange={e => { const volume = Number(e.target.value) / 100; setVolumes(prev => ({ ...prev, [id]: volume })); }} />
            <output>{Math.round((volumes[id] ?? 1) * 100)}%</output>
          </label>)}
        </fieldset>}
      </section>}
      <nav aria-label={t('groupCall.controls')} className="gcm-controls">
        <CtrlBtn icon={<CallIcon kind="camera" off={!selfHasVideo || cameraOff} />}
          label={!selfHasVideo || cameraOff ? t('call.turnCameraOn') : t('call.turnCameraOff')}
          pressed={selfHasVideo && !cameraOff} disabled={!mediaReady}
          onClick={selfHasVideo ? webrtc.toggleCamera : webrtc.upgradeToVideo} />
        <CtrlBtn icon={<CallIcon kind="mic" off={muted || !mediaReady} />}
          label={muted ? t('call.unmute') : t('call.mute')} pressed={muted} disabled={!mediaReady}
          onClick={webrtc.toggleMute} />
        <CtrlBtn icon={<CallIcon kind="output" />} label={t('groupCall.audioSettings')}
          pressed={showAudioSettings} onClick={() => setShowAudioSettings(value => !value)} />
        <CtrlBtn icon={<CallIcon kind="hangup" />} label={t('call.hangup')} danger onClick={webrtc.hangup} />
      </nav>
    </div>
    {minimized && <aside ref={miniRef} className="gcm-mini" aria-label={t('groupCall.minimized')}
      style={floating ? { left: floating.x, top: floating.y, right: 'auto', bottom: 'auto' } : undefined}>
      <div className="gcm-mini-drag" onPointerDown={beginDrag} onPointerMove={moveDrag}
        onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} aria-hidden="true"><span /></div>
      <button type="button" className="gcm-mini-restore" onClick={() => setMinimized(false)} aria-label={t('groupCall.restoreCall')}>
        <strong>{title}</strong><span>{statusText}{webrtc.connectedAt ? ` · ${timerText}` : ''}</span>
        {speakerText && <span className="gcm-mini-speaking">{speakerText}</span>}
      </button>
      {audioBlocked && <p role="status">{t('call.tapToRestoreAudio')}</p>}
      <div className="gcm-mini-actions">
        <button type="button" onClick={webrtc.toggleMute} disabled={!mediaReady} aria-pressed={muted} aria-label={muted ? t('call.unmute') : t('call.mute')}><CallIcon kind="mic" off={muted} /></button>
        <button type="button" onClick={() => setMinimized(false)} aria-label={t('groupCall.restoreCall')}><CallIcon kind="restore" /></button>
        <button type="button" className="gcm-mini-hangup" onClick={webrtc.hangup} aria-label={t('call.hangup')}><CallIcon kind="hangup" /></button>
      </div>
    </aside>}
    </>
  );
}

// ── 辅助：检测窄屏 ──────────────────────────────────────────
function isMobileWidth() {
  // 服务端渲染时默认桌面
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 480;
}

// Audio lives outside the visual tiles: no remount or duplicate playback when minimized.
function RemoteAudio({ peerId, stream, volume, register, onBlocked }) {
  const ref = useRef(null);
  useEffect(() => register(ref.current), [register]);
  useEffect(() => { if (ref.current) ref.current.volume = volume; }, [volume]);
  useEffect(() => {
    const element = ref.current;
    if (!stream || !element) return;
    let active = true;
    element.srcObject = stream;
    const play = () => {
      element.play().then(() => { if (active) onBlocked(peerId, false); })
        .catch(() => { if (active) onBlocked(peerId, true); });
    };
    play();
    const retry = () => { if (element.paused) play(); };
    window.addEventListener('pointerdown', retry);
    window.addEventListener('keydown', retry);
    window.addEventListener('call:resume-audio', retry);
    return () => {
      active = false;
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('keydown', retry);
      window.removeEventListener('call:resume-audio', retry);
      element.pause(); element.srcObject = null;
    };
  }, [stream, peerId, onBlocked]);
  return <audio ref={ref} data-peer-id={peerId} autoPlay />;
}

function Tile({ stream, streamForRef, isVideo, info, self, badge, level }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const media = stream || streamForRef;
  useEffect(() => {
    const video = ref.current;
    if (!video || !media) return;
    video.srcObject = media;
    video.play().catch(() => {});
    return () => { video.pause(); video.srcObject = null; };
  }, [media]);
  const displayName = info?.name || t('groupCall.member');
  return (
    <div aria-label={t('groupCall.participantVideoAltTemplate').replace('{name}', displayName)}
      className={`gcm-tile${self ? ' gcm-tile--self' : ''}${level?.speaking ? ' gcm-tile--speaking' : ''}`}>
      <video ref={ref} autoPlay playsInline muted className={isVideo ? 'gcm-video' : 'gcm-video gcm-video--hidden'} />
      {!isVideo && <Avatar src={info?.avatar} name={displayName} size={isMobileWidth() ? 54 : 72} />}
      <div className="gcm-member-label"><span className="gcm-member-name" title={displayName}>{displayName}</span>
        {badge && <span className="gcm-member-status">{badge}</span>}
      </div>
      <span className={`gcm-level${level?.speaking ? ' gcm-level--speaking' : ''}`} title={level?.speaking ? t('groupCall.speaking') : undefined}
        aria-label={level?.speaking ? t('groupCall.speaking') : undefined}>
        {[0,1,2].map(i => <i key={i} style={{ height: `${Math.max(3, Math.min(18, (level?.level || 0) * (i === 1 ? 32 : 22)))}px` }} />)}
      </span>
    </div>
  );
}

// ── 控制按钮 ─────────────────────────────────────────────────
function CallIcon({ kind, off }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'mic' && <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>}
    {kind === 'camera' && <><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-4v12l-6-4" /></>}
    {kind === 'output' && <><path d="M4 9h4l5-4v14l-5-4H4zM17 9a5 5 0 0 1 0 6M20 6a9 9 0 0 1 0 12" /></>}
    {kind === 'minimize' && <path d="M5 17h14" />}
    {kind === 'restore' && <path d="M5 10V5h5M14 5h5v5M19 14v5h-5M10 19H5v-5" />}
    {kind === 'hangup' && <path d="M3 15v-4c5-5 13-5 18 0v4l-5-1v-3a15 15 0 0 0-8 0v3z" />}
    {off && <path d="m3 3 18 18" />}
  </svg>;
}

function CtrlBtn({ icon, label, pressed, danger, disabled, onClick }) {
  return <button type="button" className={`gcm-control${danger ? ' gcm-control--danger' : ''}`}
    aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
    <span className="gcm-control-icon">{icon}</span><span>{label}</span>
  </button>;
}
