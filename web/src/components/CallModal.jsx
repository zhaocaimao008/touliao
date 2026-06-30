import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { mediaUrl } from '../utils/url';

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
  } catch {}
  return FALLBACK_ICE;
}

const CALL_TIMEOUT_MS = 30000;

function useCallTimer(running) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!running) { setSec(0); return; }
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

/* ── 主组件 ── */
export default function CallModal({ socket, call, onClose }) {
  const { type, direction, remoteUser, remoteId } = call;
  const isVideo = type === 'video';

  const [status, setStatus]       = useState(direction === 'incoming' ? 'incoming' : 'calling');
  const [muted, setMuted]         = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [endReason, setEndReason] = useState('');
  const [minimized, setMinimized] = useState(false);

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
  const timeoutRef      = useRef(null);
  const disconnectRef   = useRef(null);

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

  const cleanup = useCallback(() => {
    clearTimeout(timeoutRef.current);
    clearTimeout(disconnectRef.current);
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
    setTimeout(onClose, 1800);
  }, [socket, remoteId, cleanup, onClose]);

  const initPC = useCallback(async () => {
    const constraints = { audio: true, video: isVideo };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
    catch { stream = new MediaStream(); }
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
        setStatus('connected');
      } else if (s === 'disconnected') {
        disconnectRef.current = setTimeout(() => {
          if (pcRef.current?.connectionState === 'disconnected' && statusRef.current === 'connected')
            endCall(false, 'network');
        }, 5000);
      } else {
        clearTimeout(disconnectRef.current);
        if (['failed', 'closed'].includes(s) && statusRef.current === 'connected')
          endCall(false, 'network');
      }
    };
    return pc;
  }, [isVideo, socket, remoteId, endCall, attachRemoteStream]);

  const processOffer = useCallback(async (offer) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket?.emit('call:answer', { to: remoteId, answer });
    setStatus('connecting');
  }, [socket, remoteId]);

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
    const onResponse = async ({ accepted, reason, busy }) => {
      clearTimeout(timeoutRef.current);
      if (!accepted) {
        setEndReason(busy ? 'busy' : (reason || 'rejected'));
        setStatus('ended');
        cleanup();
        setTimeout(onClose, 1800);
        return;
      }
      setStatus('connecting');
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
    };
    const onIce = async ({ candidate }) => {
      try {
        if (pcRef.current && candidate)
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    };
    const onEnd = ({ reason } = {}) => {
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
  }, [socket, remoteId, cleanup, onClose, processOffer]);

  useEffect(() => {
    if (direction === 'outgoing') {
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
        style={{
          position: 'fixed',
          left: bubble.pos.x, top: bubble.pos.y,
          zIndex: 3000,
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onPointerDown={bubble.onPointerDown}
        onPointerMove={bubble.onPointerMove}
        onPointerUp={(e) => {
          bubble.onPointerUp(e);
          if (!bubble.wasMoved()) setMinimized(false);
        }}
      >
        {/* 音频持续输出（ref callback 重挂时自动恢复 srcObject） */}
        <audio ref={onRemoteAudioMount} autoPlay style={{ display: 'none' }} />

        {isVideo ? (
          <div style={{
            width: 100, height: 140,
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 6px 24px rgba(0,0,0,.5)',
            background: '#000',
            position: 'relative',
          }}>
            <video
              ref={onMiniVideoMount}
              autoPlay playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,.7))',
              padding: '18px 8px 8px',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <div style={{ color: '#fff', fontSize: 11, fontWeight: 500 }}>
                {isConnected ? timer : '连接中…'}
              </div>
            </div>
            <div
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); endCall(true); }}
              style={miniHangupStyle}
              title="挂断"
            >
              <IcoHangup />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 68, height: 68,
              borderRadius: '50%',
              position: 'relative',
              boxShadow: isConnected
                ? '0 0 0 3px rgba(7,193,96,.8), 0 6px 20px rgba(0,0,0,.4)'
                : '0 6px 20px rgba(0,0,0,.4)',
              animation: isConnected ? 'callPulse 2s ease-in-out infinite' : 'none',
            }}>
              <Avatar
                src={remoteUser?.avatar} name={remoteUser?.name || '?'}
                size={68}
                style={{ borderRadius: '50%', display: 'block' }}
              />
              <div
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); endCall(true); }}
                style={{ ...miniHangupStyle, width: 26, height: 26, bottom: -4, right: -4 }}
                title="挂断"
              >
                <IcoHangup />
              </div>
            </div>
            <div style={{
              background: 'rgba(0,0,0,.72)', borderRadius: 20,
              padding: '2px 10px',
              color: '#fff', fontSize: 11,
              backdropFilter: 'blur(6px)',
            }}>
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
      data-testid="call-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 2000, color: '#fff', overflow: 'hidden' }}
    >
      {/* 音频（ref callback 重挂恢复） */}
      <audio ref={onRemoteAudioMount} autoPlay style={{ display: 'none' }} />

      {/* ── 视频通话 ── */}
      {isVideo && <>
        <video
          ref={onRemoteVideoMount}
          autoPlay playsInline
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', background: '#000',
          }}
        />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 100, background: 'linear-gradient(to bottom, rgba(0,0,0,.6), transparent)', zIndex: 2 }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 160, background: 'linear-gradient(to top, rgba(0,0,0,.7), transparent)', zIndex: 2 }} />

        {/* 本地视频 PiP（可拖拽） */}
        {(status === 'connected' || status === 'connecting') && (
          <div
            style={{
              position: 'absolute', left: pip.pos.x, top: pip.pos.y,
              width: 100, height: 140, zIndex: 5,
              borderRadius: 14, overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0,0,0,.5)',
              cursor: 'grab', touchAction: 'none',
              border: '2px solid rgba(255,255,255,.3)',
            }}
            onPointerDown={pip.onPointerDown}
            onPointerMove={pip.onPointerMove}
            onPointerUp={pip.onPointerUp}
          >
            <video ref={onLocalVideoMount} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}

        {/* 顶部：缩小 + 名字/计时 */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 6, display: 'flex', alignItems: 'center', padding: '16px 20px 0', gap: 16 }}>
          {canMinimize && (
            <button onClick={() => setMinimized(true)} style={minimizeBtnStyle} title="缩小">
              <IcoMinimize />
            </button>
          )}
          {status !== 'incoming' && (
            <div style={{ flex: 1, textAlign: 'center', marginRight: canMinimize ? 36 : 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,.5)' }}>{remoteUser?.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', marginTop: 2 }}>
                {status === 'connected' ? timer : (status === 'calling' ? '等待对方接听…' : '连接中…')}
              </div>
            </div>
          )}
        </div>

        {/* 来电居中显示 */}
        {status === 'incoming' && (
          <div style={incomingCenterStyle}>
            <Avatar src={remoteUser?.avatar} name={remoteUser?.name || '?'} size={88} style={{ borderRadius: '50%', boxShadow: '0 4px 20px rgba(0,0,0,.4)' }} />
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 16, textShadow: '0 1px 6px rgba(0,0,0,.6)' }}>{remoteUser?.name}</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', marginTop: 8 }}>邀请你进行视频通话</div>
          </div>
        )}

        {/* 底部控制 */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 6, paddingBottom: 48 }}>
          {status === 'incoming' ? (
            <div style={btnRowStyle}>
              <CircleBtn icon={<IcoHangup />} label="拒绝" color="#FF3B30" size={68} onClick={reject} testid="call-reject-btn" />
              <CircleBtn
                icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>}
                label="接听" color="#07C160" size={68} onClick={accept} testid="call-accept-btn"
              />
            </div>
          ) : (
            <div style={btnRowStyle}>
              <CircleBtn icon={<IcoMute on={muted} />} label={muted ? '取消静音' : '静音'} active={muted} onClick={toggleMute} />
              <CircleBtn icon={<IcoHangup />} label="挂断" color="#FF3B30" size={68} onClick={() => endCall(true)} testid="call-hangup-btn" />
              <CircleBtn icon={<IcoCam off={cameraOff} />} label={cameraOff ? '开摄像头' : '关摄像头'} active={cameraOff} onClick={toggleCamera} />
            </div>
          )}
        </div>
      </>}

      {/* ── 语音通话 ── */}
      {!isVideo && <>
        <div style={{
          position: 'absolute', inset: 0,
          ...(voiceBg ? {
            backgroundImage: voiceBg,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(32px) brightness(0.35) saturate(0.4)',
            transform: 'scale(1.08)',
          } : {
            background: 'linear-gradient(160deg, #2c3e50 0%, #1a252f 100%)',
          }),
        }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,.2) 0%, rgba(0,0,0,.5) 100%)' }} />

        {canMinimize && (
          <button
            onClick={() => setMinimized(true)}
            style={{ ...minimizeBtnStyle, position: 'absolute', top: 20, left: 20, zIndex: 4 }}
            title="缩小"
          >
            <IcoMinimize />
          </button>
        )}

        <div style={{
          position: 'absolute', inset: 0, zIndex: 2,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: status === 'incoming' ? 'center' : 'flex-start',
          paddingTop: status === 'incoming' ? 0 : 80,
        }}>
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

          <div style={{ fontSize: status === 'incoming' ? 24 : 20, fontWeight: 600, marginTop: 20, textShadow: '0 1px 6px rgba(0,0,0,.5)' }}>
            {remoteUser?.name}
          </div>

          <div style={{ fontSize: 14, marginTop: 10, color: 'rgba(255,255,255,.7)', minHeight: 20 }}>
            {status === 'connected' ? <span style={{ color: '#07C160' }}>{timer}</span> :
             status === 'incoming'  ? '语音通话' :
             status === 'calling'   ? '等待对方接听…' :
             status === 'ended'     ? (END_TEXT[endReason] || '通话已结束') :
             '连接中…'}
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 4, paddingBottom: 52 }}>
          {status === 'incoming' && (
            <div style={btnRowStyle}>
              <CircleBtn icon={<IcoHangup />} label="拒绝" color="#FF3B30" size={68} onClick={reject} testid="call-reject-btn" />
              <CircleBtn
                icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>}
                label="接听" color="#07C160" size={68} onClick={accept} testid="call-accept-btn"
              />
            </div>
          )}
          {inProgress && status !== 'incoming' && (
            <div style={btnRowStyle}>
              <CircleBtn icon={<IcoMute on={muted} />} label={muted ? '取消静音' : '静音'} active={muted} onClick={toggleMute} />
              <CircleBtn icon={<IcoHangup />} label="挂断" color="#FF3B30" size={68} onClick={() => endCall(true)} testid="call-hangup-btn" />
            </div>
          )}
        </div>
      </>}

      {status === 'ended' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.55)',
        }}>
          <div style={{ fontSize: 16, color: '#fff', fontWeight: 500 }}>
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
    <div
      role="button" aria-label={label} data-testid={testid}
      tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick()}
      onClick={onClick}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, cursor: 'pointer', flexShrink: 0 }}
    >
      <div
        style={{
          width: size, height: size, borderRadius: '50%',
          background: bg,
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform .12s',
          boxShadow: '0 2px 12px rgba(0,0,0,.25)',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <span style={{ width: size * 0.44, height: size * 0.44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          {icon}
        </span>
      </div>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.75)', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

/* ── 共用样式常量 ── */
const btnRowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 48,
};

const minimizeBtnStyle = {
  background: 'rgba(255,255,255,.18)',
  backdropFilter: 'blur(6px)',
  border: 'none', borderRadius: '50%',
  width: 36, height: 36,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#fff', cursor: 'pointer', flexShrink: 0,
};

const miniHangupStyle = {
  position: 'absolute', bottom: 6, right: 6,
  width: 30, height: 30, borderRadius: '50%',
  background: '#FF3B30',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: '#fff',
};

const incomingCenterStyle = {
  position: 'absolute', inset: 0, zIndex: 3,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
};
