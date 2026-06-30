import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Avatar from './Avatar';

const FALLBACK_ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

async function fetchIceConfig() {
  try {
    const { data } = await axios.get('/api/turn/credentials');
    if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
      return { iceServers: data.iceServers };
    }
  } catch {}
  return FALLBACK_ICE;
}

const CALL_TIMEOUT_MS = 30000;

function CallTimer({ running }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!running) { setSec(0); return; }
    const t = setInterval(() => setSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return <span>{m}:{s}</span>;
}

export default function CallModal({ socket, user, call, onClose }) {
  const { type, direction, remoteUser, remoteId } = call;

  const [status, setStatus]       = useState(direction === 'incoming' ? 'incoming' : 'calling');
  const [muted, setMuted]         = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [endReason, setEndReason] = useState('');
  const [minimized, setMinimized] = useState(false);

  const pcRef              = useRef(null);
  const localStreamRef     = useRef(null);
  const localVideoRef      = useRef(null);
  const remoteVideoRef     = useRef(null);
  const remoteAudioRef     = useRef(null);
  const pendingOfferRef    = useRef(null);
  const timeoutRef         = useRef(null);
  const disconnectTimerRef = useRef(null);
  const statusRef          = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const cleanup = useCallback(() => {
    clearTimeout(timeoutRef.current);
    clearTimeout(disconnectTimerRef.current);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    if (pcRef.current) {
      pcRef.current.onicecandidate         = null;
      pcRef.current.ontrack                = null;
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
    setTimeout(onClose, 1500);
  }, [socket, remoteId, cleanup, onClose]);

  const initPC = useCallback(async () => {
    const constraints = { audio: true, video: type === 'video' };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      stream = new MediaStream();
    }
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const iceConfig = await fetchIceConfig();
    const pc = new RTCPeerConnection(iceConfig);
    pcRef.current = pc;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket?.emit('call:ice', { to: remoteId, candidate });
    };
    pc.ontrack = (e) => {
      const s = e.streams[0];
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = s;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = s;
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'disconnected') {
        disconnectTimerRef.current = setTimeout(() => {
          if (pcRef.current?.connectionState === 'disconnected' && statusRef.current === 'connected') {
            endCall(false, 'network');
          }
        }, 5000);
      } else {
        clearTimeout(disconnectTimerRef.current);
        if (['failed', 'closed'].includes(state) && statusRef.current === 'connected') {
          endCall(false, 'network');
        }
      }
    };
    return pc;
  }, [type, socket, remoteId, endCall]);

  const processOffer = useCallback(async (offer) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket?.emit('call:answer', { to: remoteId, answer });
    setStatus('connected');
  }, [socket, remoteId]);

  const startOutgoing = useCallback(async () => {
    await initPC();
    timeoutRef.current = setTimeout(() => {
      if (statusRef.current === 'calling') endCall(true, 'timeout');
    }, CALL_TIMEOUT_MS);
  }, [initPC, endCall]);

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
        setTimeout(onClose, 1500);
        return;
      }
      setStatus('connected');
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
      setTimeout(onClose, 1500);
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
    if (direction === 'outgoing') startOutgoing();
    const onBeforeUnload = () => {
      if (['calling', 'connecting', 'connected'].includes(statusRef.current)) {
        socket?.emit('call:end', { to: remoteId });
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      cleanup();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = muted; setMuted(m => !m); }
  };
  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = cameraOff; setCameraOff(c => !c); }
  };

  const END_REASON_TEXT = {
    rejected: '对方已拒绝',
    busy:     '对方正忙',
    timeout:  '无人接听',
    network:  '网络已断开',
  };

  const STATUS_TEXT = {
    calling:    '等待对方接听…',
    incoming:   `${type === 'video' ? '视频' : '语音'}通话邀请`,
    connecting: '连接中…',
    connected:  null,
    ended:      END_REASON_TEXT[endReason] || '通话已结束',
  };

  const isVideo    = type === 'video';
  const inProgress = ['calling', 'connecting', 'connected'].includes(status);
  const canMinimize = inProgress && status !== 'incoming';

  // ── 缩小模式：悬浮小条 ────────────────────────────────────────
  if (minimized) {
    return (
      <div
        onClick={() => setMinimized(false)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 3000,
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(22,22,22,0.92)', backdropFilter: 'blur(8px)',
          borderRadius: 40, padding: '8px 16px 8px 8px',
          boxShadow: '0 4px 20px rgba(0,0,0,.4)',
          cursor: 'pointer', userSelect: 'none',
          color: '#fff', fontSize: 13,
          minWidth: 160,
        }}
        title="点击展开通话"
      >
        {/* 音频输出（缩小时依然保持） */}
        <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />

        {/* 绿色波形动画点 */}
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: status === 'connected' ? 'var(--green)' : '#555',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          animation: status === 'connected' ? 'callPulse 1.5s ease-in-out infinite' : 'none',
        }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
          </svg>
        </div>

        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {remoteUser?.name}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginTop: 1 }}>
            {status === 'connected' ? <CallTimer running /> : STATUS_TEXT[status]}
          </div>
        </div>

        {/* 挂断按钮 */}
        <div
          onClick={e => { e.stopPropagation(); endCall(true); }}
          title="挂断"
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--color-badge)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, cursor: 'pointer',
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="#fff">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.12-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
          </svg>
        </div>
      </div>
    );
  }

  // ── 全屏通话界面 ──────────────────────────────────────────────
  return (
    <div data-testid="call-modal" style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: isVideo ? '#000' : 'rgba(22,22,22,0.96)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-inverse)',
    }}>
      {/* 音频输出 */}
      <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />

      {/* 远端视频全屏 */}
      {isVideo && (
        <video ref={remoteVideoRef} autoPlay playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
        />
      )}
      {/* 本地视频画中画 */}
      {isVideo && status === 'connected' && (
        <video ref={localVideoRef} autoPlay playsInline muted
          style={{ position: 'absolute', bottom: 128, right: 24, width: 120, height: 160, borderRadius: 12, objectFit: 'cover', zIndex: 2, border: '2px solid rgba(255,255,255,.3)', boxShadow: '0 4px 16px rgba(0,0,0,.4)' }}
        />
      )}

      {/* 缩小按钮（通话进行中才显示） */}
      {canMinimize && (
        <button
          onClick={() => setMinimized(true)}
          title="缩小，继续聊天"
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 4,
            background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 8,
            color: '#fff', cursor: 'pointer', padding: '6px 12px',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1z"/>
          </svg>
          缩小
        </button>
      )}

      {/* 主信息区 */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {(!isVideo || status !== 'connected') && (
          <Avatar src={remoteUser?.avatar} name={remoteUser?.name || '?'} size={96} style={{ borderRadius: 22 }} />
        )}
        <div style={{ fontSize: 22, fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,.4)' }}>
          {remoteUser?.name}
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,.65)', minHeight: 20 }}>
          {status === 'connected' ? <CallTimer running /> : STATUS_TEXT[status]}
        </div>
      </div>

      {/* 控制按钮区 */}
      <div style={{ position: 'absolute', bottom: 48, zIndex: 3, display: 'flex', alignItems: 'center', gap: 32 }}>
        {status === 'incoming' && <>
          <CtrlBtn icon="📵"                        label="拒绝"  bg="var(--color-badge)" size={64} onClick={reject} testid="call-reject-btn" />
          <CtrlBtn icon={isVideo ? '📹' : '📞'}    label="接听"  bg="var(--green)"       size={64} onClick={accept} testid="call-accept-btn" />
        </>}

        {inProgress && <>
          {isVideo && (
            <CtrlBtn
              icon={cameraOff ? '📷' : '📹'}
              label={cameraOff ? '开摄像头' : '关摄像头'}
              bg={cameraOff ? '#555' : 'rgba(255,255,255,.18)'}
              onClick={toggleCamera}
            />
          )}
          <CtrlBtn
            icon={muted ? '🔇' : '🎙️'}
            label={muted ? '取消静音' : '静音'}
            bg="rgba(255,255,255,.18)"
            onClick={toggleMute}
          />
          <CtrlBtn icon="📵" label="挂断" bg="var(--color-badge)" size={64} onClick={() => endCall(true)} testid="call-hangup-btn" />
        </>}
      </div>
    </div>
  );
}

function CtrlBtn({ icon, label, bg, size = 52, onClick, testid }) {
  return (
    <div
      role="button"
      aria-label={label}
      data-testid={testid}
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(e)}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}
      onClick={onClick}
    >
      <div
        style={{ width: size, height: size, borderRadius: size / 2, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, transition: 'transform .1s, opacity .1s' }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {icon}
      </div>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>{label}</span>
    </div>
  );
}
