import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { mediaUrl } from '../utils/url';
import './CallModal.css';

const FALLBACK_ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

async function fetchIceConfig() {
  try {
    const { data } = await axios.get('/api/turn/credentials');
    if (data && Array.isArray(data.iceServers) && data.iceServers.length)
      return { iceServers: data.iceServers };
  } catch { /* fall through to default ICE servers */ }
  return FALLBACK_ICE;
}

const CALL_TIMEOUT_MS = 30000;

function useCallTimer(running) {
  const [sec, setSec] = useState(0);
  // running 由 true→false 时归零：render 期派生（存上一次 running），避免 effect 内同步 setState
  const [prevRunning, setPrevRunning] = useState(running);
  if (running !== prevRunning) {
    setPrevRunning(running);
    if (!running) setSec(0);
  }
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/* ── 可拖拽 Hook ──
   onPointerMove 不依赖 pos（避免拖拽时每帧重建 callback）。
   moved 检测与拖拽起点比较，而非当前位置。
*/
function useDraggable(initial) {
  const [pos, setPos] = useState(initial);
  const drag = useRef({ active: false, ox: 0, oy: 0, startX: 0, startY: 0, moved: false });

  const onPointerDown = useCallback((e) => {
    drag.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      ox: e.clientX - pos.x,
      oy: e.clientY - pos.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }, [pos.x, pos.y]);

  // 没有 pos 依赖 — 拖拽中不重建
  const onPointerMove = useCallback((e) => {
    if (!drag.current.active) return;
    const nx = e.clientX - drag.current.ox;
    const ny = e.clientY - drag.current.oy;
    if (!drag.current.moved &&
        (Math.abs(e.clientX - drag.current.startX) > 4 ||
         Math.abs(e.clientY - drag.current.startY) > 4)) {
      drag.current.moved = true;
    }
    const bw = e.currentTarget?.offsetWidth  ?? 90;
    const bh = e.currentTarget?.offsetHeight ?? 90;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth  - bw, nx)),
      y: Math.max(0, Math.min(window.innerHeight - bh, ny)),
    });
  }, []); // 依赖为空，拖拽中零重建

  const onPointerUp    = useCallback(() => { drag.current.active = false; }, []);
  const wasMoved       = useCallback(() => drag.current.moved, []);

  return { pos, setPos, onPointerDown, onPointerMove, onPointerUp, wasMoved };
}

/* ── SVG 图标 ── */
const IcoMute = ({ on }) => on
  ? <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0012 7.5v2.19l4.45 4.45c.03-.2.05-.41.05-.64zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.78 8.78 0 0021 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l4.73 4.73V12a4.5 4.5 0 004.5 4.5c.55 0 1.08-.1 1.57-.27L15.34 18A8.9 8.9 0 0112 18.77c-4.28 0-7.86-3-8.77-7H1.18c.96 4.98 5.35 8.77 10.82 8.77 2.11 0 4.06-.62 5.71-1.68L21 22.73 22.27 21.46 4.27 3zM12 7.5c.28 0 .54.04.8.08L7.73 2.5A4.5 4.5 0 0012 7.5z"/></svg>
  : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15a.998.998 0 00-.98-.85c-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08a6.994 6.994 0 005.91-5.78c.1-.6-.39-1.14-1-1.14z"/></svg>;

const IcoCam = ({ off }) => off
  ? <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6.5l-4-4-1.5 1.5 4 4L21 6.5zm1.99 10.5L18 12.5l-4-4L2 2 .99 3.01 3 5H1v14h16v-2.01l2.99 3 .99-.99-2-2.01L22.99 17zM4 17V7h1l13 13H4zm11.5-5.5L14 10 9 5H21v11l-5.5-4.5z"/></svg>
  : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 8v8H5V8h10m1-2H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4V7c0-.55-.45-1-1-1z"/></svg>;

const IcoHangup = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.12-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
  </svg>
);

const IcoMinimize = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <path d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1z"/>
  </svg>
);

/* ── Focus Trap Hook ── */
function useFocusTrap(open) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]';
    const prev = document.activeElement;
    const focusFirst = () => {
      const focusable = el.querySelectorAll(sel);
      if (focusable.length) focusable[0].focus();
    };
    focusFirst();
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = el.querySelectorAll(sel);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open]);
  return ref;
}

/* ── 主组件 ── */
export default function CallModal({ socket, call, onClose }) {
  const { type, direction, remoteUser, remoteId } = call;
  const isVideo = type === 'video';

  const [status, setStatus]       = useState(direction === 'incoming' ? 'incoming' : 'calling');
  const [muted, setMuted]         = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [endReason, setEndReason] = useState('');
  const [minimized, setMinimized] = useState(false);
  const [mediaError, setMediaError] = useState(false); // 麦克风/摄像头获取失败（权限拒绝/设备占用）

  const focusTrapRef = useFocusTrap(['calling', 'connecting', 'connected'].includes(status) || status === 'incoming');
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const pcRef           = useRef(null);
  const localStreamRef  = useRef(null);
  const remoteStreamRef = useRef(null); // 保存远端流，元素重挂时用于恢复 srcObject
  const localVideoRef   = useRef(null);
  const remoteVideoRef  = useRef(null);
  const miniVideoRef    = useRef(null);
  const remoteAudioRef  = useRef(null);
  const pendingOfferRef = useRef(null);
  const pendingIceRef   = useRef([]); // 早到的对端 ICE 候选：remoteDescription 未就绪前先入队，设好后再 flush
  const timeoutRef      = useRef(null);
  const iceTimeoutRef   = useRef(null);
  const disconnectRef   = useRef(null);
  const endCallTimeoutRef = useRef(null);
  const audioCtxRef = useRef(null); // 通话提示音（WebAudio）
  const ringbackRef = useRef(null); // 回铃音循环句柄 { stop }

  const timer = useCallTimer(status === 'connected');

  const bubble = useDraggable({ x: window.innerWidth - 110, y: 80 });
  const pip    = useDraggable({ x: window.innerWidth - 130, y: 24 });

  /* ── Ref 回调：元素挂载/重挂时自动恢复 srcObject ────────────
     切换 minimized 状态时 <audio>/<video> 会重新挂载，
     React ref callback 在每次挂载时都会执行，确保流不丢失。
  */
  const onLocalVideoMount = useCallback((el) => {
    localVideoRef.current = el;
    if (el && localStreamRef.current) el.srcObject = localStreamRef.current;
  }, []);

  const onRemoteVideoMount = useCallback((el) => {
    remoteVideoRef.current = el;
    if (el && remoteStreamRef.current) el.srcObject = remoteStreamRef.current;
  }, []);

  const onMiniVideoMount = useCallback((el) => {
    miniVideoRef.current = el;
    if (el && remoteStreamRef.current) el.srcObject = remoteStreamRef.current;
  }, []);

  const onRemoteAudioMount = useCallback((el) => {
    remoteAudioRef.current = el;
    if (el && remoteStreamRef.current) el.srcObject = remoteStreamRef.current;
  }, []);

  const attachRemoteStream = useCallback((stream) => {
    remoteStreamRef.current = stream;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
    if (miniVideoRef.current)   miniVideoRef.current.srcObject   = stream;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
  }, []);

  /* ── 通话提示音（WebAudio 生成，零音频文件依赖）────────────────
     · 回铃音 ringback：主叫拨出等待期循环（中国制式「响1秒·停4秒」450Hz）
     · 接通提示音 connected：接通瞬间短促上扬「叮」
  */
  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtxRef.current = new AC();
    }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }, []);

  const startRingback = useCallback(() => {
    const ctx = getCtx();
    if (!ctx || ringbackRef.current) return;
    let stopped = false;
    const beep = () => {
      if (stopped) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 450;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.13, t + 0.05);
      gain.gain.setValueAtTime(0.13, t + 0.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 1.0);
    };
    beep();
    const iv = setInterval(beep, 5000); // 响1停4 → 周期5s
    ringbackRef.current = { stop: () => { stopped = true; clearInterval(iv); } };
  }, [getCtx]);

  const stopRingback = useCallback(() => {
    ringbackRef.current?.stop();
    ringbackRef.current = null;
  }, []);

  const playConnected = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.3);
  }, [getCtx]);

  const cleanup = useCallback(() => {
    clearTimeout(timeoutRef.current);
    clearTimeout(iceTimeoutRef.current);
    clearTimeout(disconnectRef.current);
    clearTimeout(endCallTimeoutRef.current);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    if (pcRef.current) {
      pcRef.current.onicecandidate          = null;
      pcRef.current.ontrack                 = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    localStreamRef.current = null;
  }, []);

  const endCall = useCallback((notify, reason = '') => {
    if (notify) socket?.emit('call:end', { to: remoteId, reason });
    cleanup();
    if (reason) setEndReason(reason);
    setStatus('ended');
    endCallTimeoutRef.current = setTimeout(onClose, 1800);
  }, [socket, remoteId, cleanup, onClose]);

  const initPC = useCallback(async () => {
    const constraints = { audio: true, video: isVideo };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia(constraints); setMediaError(false); }
    catch { stream = new MediaStream(); setMediaError(true); } // 权限拒绝/设备占用：仍建连但提示用户
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const iceConfig = await fetchIceConfig();
    const pc = new RTCPeerConnection(iceConfig);
    pcRef.current = pc;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket?.emit('call:ice', { to: remoteId, candidate });
    };
    pc.ontrack = (e) => attachRemoteStream(e.streams[0]);
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected' && statusRef.current === 'connecting') {
        clearTimeout(iceTimeoutRef.current);
        clearTimeout(disconnectRef.current);
        setStatus('connected');
      } else if (s === 'disconnected') {
        // iOS 锁屏/切后台时 ICE 会短暂进入 disconnected(网络探测间隙)，
        // 几秒内会自动恢复 connected。旧逻辑 5s 宽限太短 → iOS 长语音被误挂断。
        // 延长到 15s 且允许 disconnected→connected 恢复路径(上面分支已 clearTimeout)。
        // 只有持续 disconnected 超过宽限才挂断，且挂断必须通知对方(notify=true)。
        disconnectRef.current = setTimeout(() => {
          if (pcRef.current?.connectionState === 'disconnected' && statusRef.current === 'connected')
            endCall(true, 'network');
        }, 15000);
      } else {
        clearTimeout(disconnectRef.current);
        if (['failed', 'closed'].includes(s) && statusRef.current === 'connected')
          endCall(true, 'network');
      }
    };
    return pc;
  }, [isVideo, socket, remoteId, endCall, attachRemoteStream]);

  const processOffer = useCallback(async (offer) => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      // remoteDescription 就绪 → flush 之前早到的 ICE 候选（对齐原生端 pendingIce）
      for (const c of pendingIceRef.current.splice(0)) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* stale */ }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket?.emit('call:answer', { to: remoteId, answer });
      setStatus('connecting');
    } catch (err) {
      console.error('[call] processOffer 失败:', err);
      endCall(false, 'error');
    }
  }, [socket, remoteId, endCall]);

  const accept = useCallback(async () => {
    setStatus('connecting');
    await initPC();
    socket?.emit('call:response', { to: remoteId, accepted: true });
    if (pendingOfferRef.current) {
      await processOffer(pendingOfferRef.current);
      pendingOfferRef.current = null;
    }
  }, [socket, remoteId, initPC, processOffer]);

  const reject = useCallback(() => {
    socket?.emit('call:response', { to: remoteId, accepted: false, reason: 'rejected' });
    onClose();
  }, [socket, remoteId, onClose]);

  useEffect(() => {
    if (!socket) return;
    const onResponse = async ({ from, accepted, reason, busy }) => {
      if (from !== remoteId) return; // 防伪造拒接信号
      clearTimeout(timeoutRef.current);
      if (!accepted) {
        setEndReason(busy ? 'busy' : (reason || 'rejected'));
        setStatus('ended');
        cleanup();
        setTimeout(onClose, 1800);
        return;
      }
      setStatus('connecting');
      // ICE 协商超时保护：对称 NAT 无 TURN 时 connectionState 可能永远不变
      iceTimeoutRef.current = setTimeout(() => {
        if (statusRef.current === 'connecting') endCall(true, 'timeout');
      }, 30000);
      const pc = pcRef.current;
      if (!pc) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:offer', { to: remoteId, offer });
    };
    const onOffer = async ({ offer }) => {
      if (!pcRef.current) { pendingOfferRef.current = offer; return; }
      await processOffer(offer);
    };
    const onAnswer = async ({ answer }) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      // remoteDescription 就绪 → flush 之前早到的 ICE 候选（对齐原生端 pendingIce）
      for (const c of pendingIceRef.current.splice(0)) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* stale */ }
      }
    };
    const onIce = async ({ candidate }) => {
      const pc = pcRef.current;
      if (!pc || !candidate) return;
      // 对齐 Android/iOS：remoteDescription 未就绪时，早到的候选必须入队而非丢弃，
      // 否则对端（尤其原生端 trickle ICE 发得早）的关键候选丢失 → 永久卡"连接中"。
      if (!pc.remoteDescription || !pc.remoteDescription.type) {
        pendingIceRef.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch { /* stale/duplicate ICE candidate; safe to ignore */ }
    };
    const onEnd = ({ from, reason } = {}) => {
      if (from !== remoteId) return; // 防任意用户强制关闭通话界面
      if (reason) setEndReason(reason);
      setStatus('ended');
      cleanup();
      setTimeout(onClose, 1800);
    };
    socket.on('call:response', onResponse);
    socket.on('call:offer',    onOffer);
    socket.on('call:answer',   onAnswer);
    socket.on('call:ice',      onIce);
    socket.on('call:end',      onEnd);
    return () => {
      socket.off('call:response', onResponse);
      socket.off('call:offer',    onOffer);
      socket.off('call:answer',   onAnswer);
      socket.off('call:ice',      onIce);
      socket.off('call:end',      onEnd);
    };
  }, [socket, remoteId, cleanup, onClose, processOffer, endCall]);

  // 挂载即发起/准备通话：initPC 建立 RTCPeerConnection、getUserMedia 等外部系统副作用，
  // 其内部 setState 属正当的取媒体流程，非可派生同步状态。
  useEffect(() => {
    if (direction === 'outgoing') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：WebRTC 初始化副作用
      initPC().then(() => {
        timeoutRef.current = setTimeout(() => {
          if (statusRef.current === 'calling') endCall(true, 'timeout');
        }, CALL_TIMEOUT_MS);
      });
    }
    const onUnload = () => {
      if (['calling', 'connecting', 'connected'].includes(statusRef.current))
        socket?.emit('call:end', { to: remoteId });
    };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); cleanup(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 提示音生命周期：主叫拨出等待→回铃音循环；接通瞬间→提示音一声
  useEffect(() => {
    if (status === 'calling') startRingback();
    else stopRingback();
    if (status === 'connected') playConnected();
  }, [status, startRingback, stopRingback, playConnected]);

  // 卸载兜底：停回铃音 + 释放 AudioContext
  useEffect(() => () => {
    stopRingback();
    try { audioCtxRef.current?.close?.(); } catch { /* already closed */ }
  }, [stopRingback]);

  const toggleMute = useCallback(() => {
    const t = localStreamRef.current?.getAudioTracks()[0];
    if (t) { t.enabled = muted; setMuted(m => !m); }
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const t = localStreamRef.current?.getVideoTracks()[0];
    if (t) { t.enabled = cameraOff; setCameraOff(c => !c); }
  }, [cameraOff]);

  const END_TEXT = { rejected: '对方已拒绝', busy: '对方正忙', timeout: '无人接听', network: '网络已断开' };
  const inProgress  = ['calling', 'connecting', 'connected'].includes(status);
  const canMinimize = inProgress && status !== 'incoming';

  /* ═══════════════════════════════════════════════════════════════
     缩小悬浮窗
  ═══════════════════════════════════════════════════════════════ */
  if (minimized) {
    const isConnected = status === 'connected';
    return (
      <div
        className="cm-bubble"
        style={{ left: bubble.pos.x, top: bubble.pos.y }}
        onPointerDown={bubble.onPointerDown}
        onPointerMove={bubble.onPointerMove}
        onPointerUp={(e) => {
          bubble.onPointerUp(e);
          if (!bubble.wasMoved()) setMinimized(false);
        }}
      >
        {/* 音频持续输出（ref callback 重挂时自动恢复 srcObject） */}
        <audio ref={onRemoteAudioMount} autoPlay hidden />

        {isVideo ? (
          <div className="cm-bubble-video">
            <video ref={onMiniVideoMount} autoPlay playsInline />
            <div className="cm-bubble-video-overlay">
              <span className="cm-bubble-timer">
                {isConnected ? timer : '连接中…'}
              </span>
            </div>
            <button
              type="button"
              className="cm-mini-hangup"
              aria-label="挂断"
              title="挂断"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); endCall(true); }}
            >
              <IcoHangup />
            </button>
          </div>
        ) : (
          <div className="cm-bubble-audio">
            <div
              className="cm-bubble-audio-avatar"
              style={{
                boxShadow: isConnected
                  ? '0 0 0 3px rgba(7,193,96,.8), 0 6px 20px rgba(0,0,0,.4)'
                  : '0 6px 20px rgba(0,0,0,.4)',
                animation: isConnected ? 'callPulse 2s ease-in-out infinite' : 'none',
              }}
            >
              <Avatar
                src={remoteUser?.avatar} name={remoteUser?.name || '?'}
                size={68}
                style={{ borderRadius: '50%', display: 'block' }}
              />
              <button
                type="button"
                className="cm-mini-hangup"
                aria-label="挂断"
                title="挂断"
                style={{ width: 26, height: 26, bottom: -4, right: -4 }}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); endCall(true); }}
              >
                <IcoHangup />
              </button>
            </div>
            <div className="cm-bubble-audio-label">
              {isConnected ? timer : (status === 'calling' ? '等待接听…' : '连接中…')}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     全屏通话界面
  ═══════════════════════════════════════════════════════════════ */

  const voiceBg = remoteUser?.avatar ? `url(${mediaUrl(remoteUser.avatar)})` : null;

  return (
    <div
      ref={focusTrapRef}
      data-testid="call-modal"
      role="dialog"
      aria-modal="true"
      aria-label={isVideo ? '视频通话' : '语音通话'}
      className="cm-dialog"
    >
      {/* 音频（ref callback 重挂恢复） */}
      <audio ref={onRemoteAudioMount} autoPlay hidden />

      {/* 麦克风/摄像头获取失败提示 */}
      {mediaError && (
        <div role="alert" className="cm-media-error">
          无法访问{isVideo ? '摄像头/麦克风' : '麦克风'}，对方将听不到你，请检查浏览器权限或设备占用
        </div>
      )}

      {/* ── 视频通话 ── */}
      {isVideo && <>
        <video
          ref={onRemoteVideoMount}
          autoPlay playsInline
          className="cm-remote-video"
        />
        <div className="cm-scrim-top" />
        <div className="cm-scrim-bottom" />

        {/* 本地视频 PiP（可拖拽） */}
        {(status === 'connected' || status === 'connecting') && (
          <div
            className="cm-pip"
            style={{ left: pip.pos.x, top: pip.pos.y }}
            onPointerDown={pip.onPointerDown}
            onPointerMove={pip.onPointerMove}
            onPointerUp={pip.onPointerUp}
          >
            <video ref={onLocalVideoMount} autoPlay playsInline muted />
          </div>
        )}

        {/* 顶部：缩小 + 名字/计时 */}
        <div className="cm-video-top">
          {canMinimize && (
            <button type="button" onClick={() => setMinimized(true)} className="cm-minimize-btn" title="缩小" aria-label="缩小">
              <IcoMinimize />
            </button>
          )}
          {status !== 'incoming' && (
            <div className="cm-video-name" style={{ marginRight: canMinimize ? 36 : 0 }}>
              <div className="cm-video-name-text">{remoteUser?.name}</div>
              <div className="cm-video-status">
                {status === 'connected' ? timer : (status === 'calling' ? '等待对方接听…' : '连接中…')}
              </div>
            </div>
          )}
        </div>

        {/* 来电居中显示 */}
        {status === 'incoming' && (
          <div className="cm-incoming-center">
            <Avatar src={remoteUser?.avatar} name={remoteUser?.name || '?'} size={88} style={{ borderRadius: '50%', boxShadow: '0 4px 20px rgba(0,0,0,.4)' }} />
            <div className="cm-incoming-name">{remoteUser?.name}</div>
            <div className="cm-incoming-desc">邀请你进行视频通话</div>
          </div>
        )}

        {/* 底部控制 */}
        <div className="cm-controls-bottom">
          {status === 'incoming' ? (
            <div className="cm-btn-row">
              <CircleBtn icon={<IcoHangup />} label="拒绝" color="var(--color-danger)" size={68} onClick={reject} testid="call-reject-btn" />
              <CircleBtn
                icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>}
                label="接听" color="var(--color-success)" size={68} onClick={accept} testid="call-accept-btn"
              />
            </div>
          ) : (
            <div className="cm-btn-row">
              <CircleBtn icon={<IcoMute on={muted} />} label={muted ? '取消静音' : '静音'} active={muted} onClick={toggleMute} />
              <CircleBtn icon={<IcoHangup />} label="挂断" color="var(--color-danger)" size={68} onClick={() => endCall(true)} testid="call-hangup-btn" />
              <CircleBtn icon={<IcoCam off={cameraOff} />} label={cameraOff ? '开摄像头' : '关摄像头'} active={cameraOff} onClick={toggleCamera} />
            </div>
          )}
        </div>
      </>}

      {/* ── 语音通话 ── */}
      {!isVideo && <>
        <div
          className="cm-voice-bg"
          style={voiceBg ? {
            backgroundImage: voiceBg,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(32px) brightness(0.35) saturate(0.4)',
            transform: 'scale(1.08)',
          } : undefined}
        />
        <div className="cm-scrim-full" />

        {canMinimize && (
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="cm-minimize-btn"
            style={{ position: 'absolute', top: 20, left: 20, zIndex: 4 }}
            title="缩小"
            aria-label="缩小"
          >
            <IcoMinimize />
          </button>
        )}

        <div
          className="cm-voice-content"
          style={{
            justifyContent: status === 'incoming' ? 'center' : 'flex-start',
            paddingTop: status === 'incoming' ? 0 : 80,
          }}
        >
          <div style={{
            width: status === 'incoming' ? 110 : 96,
            height: status === 'incoming' ? 110 : 96,
            borderRadius: '50%',
            boxShadow: status === 'connected'
              ? '0 0 0 4px rgba(7,193,96,.6), 0 8px 32px rgba(0,0,0,.5)'
              : '0 8px 32px rgba(0,0,0,.5)',
            animation: status === 'connected' ? 'callPulse 2s ease-in-out infinite' : 'none',
            transition: 'box-shadow .4s',
          }}>
            <Avatar
              src={remoteUser?.avatar} name={remoteUser?.name || '?'}
              size={status === 'incoming' ? 110 : 96}
              style={{ borderRadius: '50%', display: 'block' }}
            />
          </div>

          <div className="cm-voice-name" style={{ fontSize: status === 'incoming' ? 24 : 20 }}>
            {remoteUser?.name}
          </div>

          <div className="cm-voice-status">
            {status === 'connected' ? <span style={{ color: 'var(--color-success)' }}>{timer}</span> :
             status === 'incoming'  ? '语音通话' :
             status === 'calling'   ? '等待对方接听…' :
             status === 'ended'     ? (END_TEXT[endReason] || '通话已结束') :
             '连接中…'}
          </div>
        </div>

        <div className="cm-voice-bottom">
          {status === 'incoming' && (
            <div className="cm-btn-row">
              <CircleBtn icon={<IcoHangup />} label="拒绝" color="var(--color-danger)" size={68} onClick={reject} testid="call-reject-btn" />
              <CircleBtn
                icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>}
                label="接听" color="var(--color-success)" size={68} onClick={accept} testid="call-accept-btn"
              />
            </div>
          )}
          {inProgress && status !== 'incoming' && (
            <div className="cm-btn-row">
              <CircleBtn icon={<IcoMute on={muted} />} label={muted ? '取消静音' : '静音'} active={muted} onClick={toggleMute} />
              <CircleBtn icon={<IcoHangup />} label="挂断" color="var(--color-danger)" size={68} onClick={() => endCall(true)} testid="call-hangup-btn" />
            </div>
          )}
        </div>
      </>}

      {status === 'ended' && (
        <div className="cm-ended-overlay">
          <div className="cm-ended-text">
            {END_TEXT[endReason] || '通话已结束'}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 圆形控制按钮 ── */
function CircleBtn({ icon, label, color, size = 54, active, onClick, testid }) {
  const bg = color || (active ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.15)');
  return (
    <button
      type="button"
      aria-label={label} data-testid={testid}
      onClick={onClick}
      className="cm-circle-btn"
    >
      <span
        className="cm-circle-btn-disc"
        style={{ width: size, height: size, background: bg }}
      >
        <span className="cm-circle-btn-icon" style={{ width: size * 0.44, height: size * 0.44 }}>
          {icon}
        </span>
      </span>
      <span className="cm-circle-btn-label">{label}</span>
    </button>
  );
}
