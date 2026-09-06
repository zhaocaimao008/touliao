import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { showToast } from '../utils/toast';
import { installPrewarm, startRingback as toneRingback, stopTone, playConnectedTone } from '../utils/callTones';
import { tuneSdpForWeakNetwork } from '../utils/sdpTune';
import { videoConstraints, capVideoBitrate, preferH264 } from '../utils/callMedia';
import { useI18n } from '../contexts/I18nContext';

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
      else if (tileCount <= 4) setCols(w < 480 ? 1 : 2);
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
    const focusableSel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]';
    const prevFocus = document.activeElement;
    const focusFirst = () => {
      const els = container.querySelectorAll(focusableSel);
      if (els.length) els[0].focus();
    };
    focusFirst();
    const handler = (e) => {
      if (e.key !== 'Tab') return;
      const els = container.querySelectorAll(focusableSel);
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
  // B-1：本端当前是否真的持有视频轨。语音会话初始 false（升级后置 true）；视频会话
  // gUM 失败（空流保底）时也为 false——此时"开摄像头"按钮成为重试入口。
  const [selfHasVideo, setSelfHasVideo] = useState(isVideo);
  // B-1：远端成员是否送来过视频轨（peerId → true）。语音会话里对端升级后靠 ontrack
  // 自然置位，Tile 据此切视频布局，无需额外信令。
  const [remoteVideo, setRemoteVideo] = useState({});
  const [remoteStreams, setRemoteStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [status, setStatus] = useState(mode === 'start' ? 'calling' : 'joining');

  const localStreamRef = useRef(null);
  const selfHasVideoRef = useRef(isVideo);
  const upgradingRef = useRef(false);        // 防升级按钮连点重复 gUM/重协商
  const upgradeStreamRef = useRef(null);     // 升级取到的视频流引用，防 GC 停轨（对齐 1v1 videoAddStreamRef）
  const iceCfgRef = useRef(FALLBACK_ICE);
  const pcsRef = useRef(new Map());
  const remoteSetRef = useRef(new Set());
  const pendingIceRef = useRef(new Map());
  const callIdRef = useRef(session.callId || null);
  const closedRef = useRef(false);
  // ICE restart 自愈(网络切换):peerId → 重启计数 / {debounce, recover} 定时器。
  // 与 1:1 同策略:disconnected 3s 防抖 → restartIce → 15s 窗口 → 最多 3 次 → removePeer。
  const peerRestartCountRef = useRef(new Map());
  const peerRestartTimersRef = useRef(new Map());
  const ICE_RESTART_DEBOUNCE_MS = 3000;
  const ICE_RESTART_WINDOW_MS   = 15000;
  const ICE_RESTART_MAX         = 3;

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
    if (pc) { try { pc.close(); } catch { /* 连接已关闭 */ } pcsRef.current.delete(peerId); }
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
  }, [reapplyCaps]);

  const drainIce = useCallback((peerId) => {
    const pc = pcsRef.current.get(peerId);
    const pending = pendingIceRef.current.get(peerId);
    if (pc && pending) {
      pending.forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
      pendingIceRef.current.delete(peerId);
    }
  }, []);

  const createPC = useCallback((peerId) => {
    if (pcsRef.current.has(peerId)) return pcsRef.current.get(peerId);
    const pc = new RTCPeerConnection(iceCfgRef.current);
    pcsRef.current.set(peerId, pc);
    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket?.emit('group_call:ice', { callId: callIdRef.current, to: peerId, candidate });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      setRemoteStreams(prev => (prev[peerId] === stream ? prev : { ...prev, [peerId]: stream }));
      // B-1：远端语音→视频升级后新到的视频轨——置位让 Tile 切视频布局（WebRTC 轨自然触发）
      if (e.track.kind === 'video') setRemoteVideo(prev => (prev[peerId] ? prev : { ...prev, [peerId]: true }));
    };
    // ICE restart 状态机(与 1:1 同策略):disconnected 3s 防抖 → restartIce → 15s 窗口
    // → 最多 3 次 → removePeer。信令复用 group_call:offer/answer/ice,后端零改动。
    const tryPeerRestart = async () => {
      const count = peerRestartCountRef.current.get(peerId) || 0;
      if (count >= ICE_RESTART_MAX) { removePeer(peerId); return; }
      peerRestartCountRef.current.set(peerId, count + 1);
      pc.restartIce();
      // restartIce() 只打标记，必须实际重协商 offer 对方才会重新打通（对齐 1:1/iOS/Android 修复）
      try {
        const offer = await pc.createOffer();
        const tunedOffer = tuneSdpForWeakNetwork(offer.sdp);
        await pc.setLocalDescription(new RTCSessionDescription({ type: offer.type, sdp: tunedOffer }));
        socket?.emit('group_call:offer', { callId: callIdRef.current, to: peerId, offer: { type: offer.type, sdp: tunedOffer } });
      } catch (err) {
        console.error('[groupCall] ICE restart 重协商失败:', err);
      }
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
  }, [socket, removePeer, reapplyCaps]);

  // 对单个 peer 建 offer 并发送（含 H264 偏好 + 弱网调优）。onPeerJoined（新成员入会）
  // 与 B-1 语音→视频升级的逐 peer 重协商共用；mesh 无集中媒体单元，每 peer 独立一份
  // offer/answer。signalingState 非 stable（如撞上 ICE restart 重协商窗口）时跳过——
  // 轨已 addTrack，该 peer 下一次协商自然带上。
  const sendOfferToPeer = useCallback(async (peerId) => {
    const pc = pcsRef.current.get(peerId);
    if (!pc || pc.signalingState !== 'stable') return;
    await preferH264(pc);   // A-2：addTrack 后、createOffer 前设 H264 优先（setCodecPreferences 须先于协商）
    const offer = await pc.createOffer();
    const tunedOffer = tuneSdpForWeakNetwork(offer.sdp);
    await pc.setLocalDescription(new RTCSessionDescription({ type: offer.type, sdp: tunedOffer }));
    socket?.emit('group_call:offer', { callId: callIdRef.current, to: peerId, offer: { type: offer.type, sdp: tunedOffer } });
  }, [socket]);

  const cleanup = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (callIdRef.current) socket?.emit('group_call:leave', { callId: callIdRef.current });
    pcsRef.current.forEach(pc => { try { pc.onicecandidate = null; pc.ontrack = null; pc.close(); } catch { /* 连接已关闭 */ } });
    pcsRef.current.clear();
    peerRestartTimersRef.current.forEach(t => { clearTimeout(t.debounce); clearTimeout(t.recover); });
    peerRestartTimersRef.current.clear();
    peerRestartCountRef.current.clear();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
  }, [socket]);

  const hangup = useCallback(() => { cleanup(); }, [cleanup]);

  const toggleMute = useCallback(() => {
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
    if (selfHasVideoRef.current || upgradingRef.current) return;
    upgradingRef.current = true;
    try {
      const vs = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(true), audio: false });
      const track = vs.getVideoTracks()[0];
      if (!track) return;
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
        try { pc.addTrack(track, localStreamRef.current); } catch { /* 该 pc 已带此轨 */ }
        await sendOfferToPeer(pid);
      }
      reapplyCaps();
    } catch (e) {
      console.error('[groupCall] 升级视频失败:', e);
      showToast(t('call.cameraOpenFailed'), 'error');
    } finally {
      upgradingRef.current = false;
    }
  }, [sendOfferToPeer, reapplyCaps, t]);

  const peerIds = Object.keys(remoteStreams);
  const tileCount = peerIds.length + 1;

  // ── 初始化媒体 ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoConstraints(isVideo) }); }
      catch { /* 权限拒绝/设备占用，用空流保底 */ stream = new MediaStream(); }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      localStreamRef.current = stream;
      setLocalStream(stream);
      // B-1：以"实际拿到视频轨"为准（视频会话 gUM 失败/空流保底 → false，升级按钮变重试入口）
      selfHasVideoRef.current = stream.getVideoTracks().length > 0;
      setSelfHasVideo(selfHasVideoRef.current);
      iceCfgRef.current = await fetchIceConfig();
      if (cancelled) return;
      if (mode === 'start') socket?.emit('group_call:start', { conversationId, type });
      else socket?.emit('group_call:join', { callId: callIdRef.current });
    })();
    return () => { cancelled = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 信令事件 ──────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onStarted = ({ callId: cid }) => { callIdRef.current = cid; setCallId(cid); setStatus('connected'); };
    const onPeers = async ({ callId: cid, peers }) => {
      callIdRef.current = cid; setCallId(cid); setStatus('connected');
      peers.forEach(pid => createPC(pid));
    };
    const onPeerJoined = async ({ userId: pid }) => {
      createPC(pid);
      await sendOfferToPeer(pid);   // B-1：与新成员建连 / 升级重协商共用的发 offer 路径
    };
    const onOffer = async ({ from, offer }) => {
      const pc = createPC(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteSetRef.current.add(from); drainIce(from);
      await preferH264(pc);   // A-2：被叫路径——setRemoteDescription 后、createAnswer 前（远端 offer 可能新建视频 transceiver）
      const answer = await pc.createAnswer();
      const tunedAnswer = tuneSdpForWeakNetwork(answer.sdp);
      await pc.setLocalDescription(new RTCSessionDescription({ type: answer.type, sdp: tunedAnswer }));
      socket.emit('group_call:answer', { callId: callIdRef.current, to: from, answer: { type: answer.type, sdp: tunedAnswer } });
    };
    const onAnswer = async ({ from, answer }) => {
      const pc = pcsRef.current.get(from);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      remoteSetRef.current.add(from); drainIce(from);
    };
    const onIce = ({ from, candidate }) => {
      const pc = pcsRef.current.get(from);
      if (pc && remoteSetRef.current.has(from)) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        const arr = pendingIceRef.current.get(from) || [];
        arr.push(candidate);
        pendingIceRef.current.set(from, arr);
      }
    };
    const onPeerLeft = ({ userId: pid }) => removePeer(pid);
    const onError = ({ reason }) => {
      const msg = {
        busy: t('groupCall.errorBusy'),
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
    const onEnded = ({ reason }) => {
      showToast(reason === 'timeout' ? t('groupCall.endedTimeout') : t('call.callEnded'), 'info');
      hangup();
      onClose?.();
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
  }, [socket, createPC, drainIce, removePeer, hangup, onClose, sendOfferToPeer, t]);

  return {
    callId, muted, cameraOff, selfHasVideo, remoteVideo, remoteStreams, localStream, status,
    peerIds, tileCount, localStreamRef, isVideo,
    toggleMute, toggleCamera, upgradeToVideo, hangup, cleanup,
  };
}

// ════════════════════════════════════════════════════════════════
//  主组件
// ════════════════════════════════════════════════════════════════
export default function GroupCallModal({ socket, user, session, nameOf, onClose }) {
  const { t } = useI18n();
  const webrtc = useGroupCallWebRTC({ socket, user, session, nameOf, onClose });
  const cols = useResponsiveGrid(webrtc.tileCount);
  const containerRef = useFocusTrap(true);
  const toneRef = useRef(null); // 回铃音循环句柄 { stop }
  const { muted, cameraOff, remoteStreams, remoteVideo, localStream, status, isVideo, selfHasVideo, peerIds, tileCount } = webrtc;

  // 主叫等待期回铃音：status='calling'(发出 start 到有人加入/结束)循环；
  // 其余状态停止。接通瞬间播一声提示音。
  useEffect(() => {
    if (status === 'calling' && !toneRef.current) {
      stopTone();
      toneRef.current = toneRingback();
    } else if (status !== 'calling') {
      toneRef.current?.stop();
      toneRef.current = null;
    }
    if (status === 'connected') playConnectedTone();
    return () => { toneRef.current?.stop(); toneRef.current = null; };
  }, [status]);

  const handleHangup = () => {
    toneRef.current?.stop();
    toneRef.current = null;
    webrtc.hangup();
    webrtc.cleanup();
    onClose();
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={t('groupCall.title')}
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: "var(--z-call)",
        background: 'rgba(18,18,18,0.97)',
        display: 'flex', flexDirection: 'column',
        color: 'var(--text-inverse)',
      }}
    >
      {/* 顶部状态栏 */}
      <header style={{
        textAlign: 'center', padding: '14px 12px 6px',
        fontSize: isMobileWidth() ? 13 : 15,
        color: 'rgba(255,255,255,.85)',
      }}>
        {t('groupCall.headerTemplate')
          .replace('{type}', isVideo ? t('groupCall.videoCallLabel') : t('groupCall.voiceCallLabel'))
          .replace('{count}', tileCount)}
        <span style={{
          fontSize: isMobileWidth() ? 11 : 12,
          color: 'rgba(255,255,255,.45)', marginLeft: 8,
        }}>
          {status === 'connected' ? t('groupCall.statusConnected') : (webrtc.callId ? t('groupCall.statusWaitingOthers') : t('groupCall.statusJoining'))}
        </span>
      </header>

      {/* 画面宫格 — 响应式 */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: isMobileWidth() ? 4 : 6,
        padding: isMobileWidth() ? 6 : 10,
        alignContent: 'center', overflow: 'auto',
      }}>
        <Tile
          stream={localStream}
          muted
          isVideo={selfHasVideo && !cameraOff}
          info={{ name: t('home.tab.me'), avatar: user?.avatar }}
          self
        />
        {peerIds.map(pid => (
          <Tile
            key={pid}
            streamForRef={remoteStreams[pid]}
            isVideo={isVideo || !!remoteVideo[pid]}
            info={nameOf?.(pid) || { name: t('groupCall.member') }}
          />
        ))}
      </div>

      {/* 控制区 — 响应式 */}
      <nav aria-label={t('groupCall.controls')} style={{
        display: 'flex', justifyContent: 'center', gap: isMobileWidth() ? 20 : 28,
        padding: isMobileWidth() ? '14px 0 24px' : '18px 0 34px',
      }}>
        {webrtc.selfHasVideo ? (
          <CtrlBtn
            icon={cameraOff ? '📷' : '📹'}
            label={cameraOff ? t('call.turnCameraOn') : t('call.turnCameraOff')}
            bg={cameraOff ? '#555' : 'rgba(255,255,255,.18)'}
            size={isMobileWidth() ? 44 : 52}
            onClick={webrtc.toggleCamera}
          />
        ) : (
          /* B-1：语音模式/取流失败时也显示摄像头按钮——点击即升级视频（补轨+重协商） */
          <CtrlBtn
            icon="📷"
            label={t('call.turnCameraOn')}
            bg="#555"
            size={isMobileWidth() ? 44 : 52}
            onClick={webrtc.upgradeToVideo}
          />
        )}
        <CtrlBtn
          icon={muted ? '🔇' : '🎙️'}
          label={muted ? t('call.unmute') : t('call.mute')}
          bg="rgba(255,255,255,.18)"
          size={isMobileWidth() ? 44 : 52}
          onClick={webrtc.toggleMute}
        />
        <CtrlBtn
          icon="📵"
          label={t('call.hangup')}
          bg="var(--color-badge)"
          size={isMobileWidth() ? 54 : 64}
          onClick={handleHangup}
        />
      </nav>
    </div>
  );
}

// ── 辅助：检测窄屏 ──────────────────────────────────────────
function isMobileWidth() {
  // 服务端渲染时默认桌面
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 480;
}

// ── 单路画面 ─────────────────────────────────────────────────
function Tile({ stream, streamForRef, muted, isVideo, info, self }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const s = stream || streamForRef;
  // B-4（2026-09-05）：srcObject 挂上后显式 play() 兜底，被 autoplay 手势策略拦下时在
  // 画面上出"点击恢复声音"提示，任意点击/按键自动重试。自己（muted）不会被拦。
  const [playBlocked, setPlayBlocked] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  useEffect(() => {
    if (!ref.current || !s) return;
    ref.current.srcObject = s;
    try { ref.current.play().catch(() => setPlayBlocked(true)); }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 老浏览器同步抛错的兜底路径,与上方异步 catch 置同一状态(7.x 误报边界)
    catch { setPlayBlocked(true); }
  }, [s]);
  useEffect(() => {
    if (!playBlocked) return;
    const retry = () => {
      ref.current?.play().then(() => setPlayBlocked(false)).catch(() => {});
    };
    window.addEventListener('pointerdown', retry);
    window.addEventListener('keydown', retry);
    return () => {
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('keydown', retry);
    };
  }, [playBlocked]);
  const displayName = info?.name || t('groupCall.member');
  return (
    <div
      aria-label={t('groupCall.participantVideoAltTemplate').replace('{name}', displayName)}
      style={{
        position: 'relative', background: '#000', borderRadius: 'var(--radius-md)',
        overflow: 'hidden', minHeight: isMobileWidth() ? 100 : 140,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: self ? '2px solid var(--color-primary,#6D5AE6)' : '1px solid rgba(255,255,255,.08)',
      }}
    >
      <video
        ref={ref} autoPlay playsInline muted={muted}
        style={{
          width: '100%', height: '100%', objectFit: 'cover',
          display: isVideo ? 'block' : 'none',
        }}
      />
      {!isVideo && (
        <Avatar src={info?.avatar} name={info?.name || '?'} size={isMobileWidth() ? 54 : 72}
          style={{ borderRadius: 'var(--radius-xl)' }} />
      )}
      <div style={{
        position: 'absolute', bottom: 6, left: 8,
        fontSize: isMobileWidth() ? 11 : 12,
        color: 'var(--text-inverse)',
        textShadow: '0 1px 3px rgba(0,0,0,.6)',
      }}>
        {displayName}
      </div>

      {/* B-4：autoplay 被拦——点击/按键任意处即恢复，✕ 只关提示 */}
      {playBlocked && !hintDismissed && !self && (
        <div
          role="status"
          style={{
            position: 'absolute', top: 6, left: 6, right: 6, zIndex: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
            padding: '4px 8px', borderRadius: 8, background: 'rgba(0,0,0,.72)',
            color: '#fff', fontSize: 11, whiteSpace: 'nowrap',
          }}
        >
          <span>🔇 {t('call.tapToRestoreAudio')}</span>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setHintDismissed(true)}
            style={{ border: 0, background: 'transparent', color: 'rgba(255,255,255,.75)', cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ── 控制按钮 ─────────────────────────────────────────────────
function CtrlBtn({ icon, label, bg, size = 52, onClick }) {
  return (
    <div
      role="button"
      aria-label={label}
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
      }}
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: isMobileWidth() ? 6 : 8, cursor: 'pointer',
      }}
    >
      <div style={{
        width: size, height: size, borderRadius: size / 2,
        background: bg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: size * 0.42,
      }}>
        {icon}
      </div>
      <span style={{ fontSize: isMobileWidth() ? 10 : 11, color: 'rgba(255,255,255,.6)' }}>
        {label}
      </span>
    </div>
  );
}
