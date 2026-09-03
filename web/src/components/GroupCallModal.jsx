import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { showToast } from '../utils/toast';
import { installPrewarm, startRingback as toneRingback, stopTone, playConnectedTone } from '../utils/callTones';
import { tuneSdpForWeakNetwork } from '../utils/sdpTune';
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
  const [remoteStreams, setRemoteStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [status, setStatus] = useState(mode === 'start' ? 'calling' : 'joining');

  const localStreamRef = useRef(null);
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

  const removePeer = useCallback((peerId) => {
    const pc = pcsRef.current.get(peerId);
    if (pc) { try { pc.close(); } catch { /* 连接已关闭 */ } pcsRef.current.delete(peerId); }
    remoteSetRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    setRemoteStreams(prev => {
      if (!(peerId in prev)) return prev;
      const n = { ...prev }; delete n[peerId]; return n;
    });
  }, []);

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
  }, [socket, removePeer]);

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

  const peerIds = Object.keys(remoteStreams);
  const tileCount = peerIds.length + 1;

  // ── 初始化媒体 ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo }); }
      catch { /* 权限拒绝/设备占用，用空流保底 */ stream = new MediaStream(); }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      localStreamRef.current = stream;
      setLocalStream(stream);
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
      const pc = createPC(pid);
      const offer = await pc.createOffer();
      const tunedOffer = tuneSdpForWeakNetwork(offer.sdp);
      await pc.setLocalDescription(new RTCSessionDescription({ type: offer.type, sdp: tunedOffer }));
      socket.emit('group_call:offer', { callId: callIdRef.current, to: pid, offer: { type: offer.type, sdp: tunedOffer } });
    };
    const onOffer = async ({ from, offer }) => {
      const pc = createPC(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteSetRef.current.add(from); drainIce(from);
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
  }, [socket, createPC, drainIce, removePeer, hangup, onClose, t]);

  return {
    callId, muted, cameraOff, remoteStreams, localStream, status,
    peerIds, tileCount, localStreamRef, isVideo,
    toggleMute, toggleCamera, hangup, cleanup,
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
  const { muted, cameraOff, remoteStreams, localStream, status, isVideo, peerIds, tileCount } = webrtc;

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
          isVideo={isVideo && !cameraOff}
          info={{ name: t('home.tab.me'), avatar: user?.avatar }}
          self
        />
        {peerIds.map(pid => (
          <Tile
            key={pid}
            streamForRef={remoteStreams[pid]}
            isVideo={isVideo}
            info={nameOf?.(pid) || { name: t('groupCall.member') }}
          />
        ))}
      </div>

      {/* 控制区 — 响应式 */}
      <nav aria-label={t('groupCall.controls')} style={{
        display: 'flex', justifyContent: 'center', gap: isMobileWidth() ? 20 : 28,
        padding: isMobileWidth() ? '14px 0 24px' : '18px 0 34px',
      }}>
        {isVideo && (
          <CtrlBtn
            icon={cameraOff ? '📷' : '📹'}
            label={cameraOff ? t('call.turnCameraOn') : t('call.turnCameraOff')}
            bg={cameraOff ? '#555' : 'rgba(255,255,255,.18)'}
            size={isMobileWidth() ? 44 : 52}
            onClick={webrtc.toggleCamera}
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
  useEffect(() => { if (ref.current && s) ref.current.srcObject = s; }, [s]);
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
