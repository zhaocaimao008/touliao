import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Avatar from './Avatar';

// 仅在拉取 /api/turn/credentials 失败时兜底（STUN-only，对称 NAT 下可能接不通）
const FALLBACK_ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// 向后端动态拉取 ICE（含时效 TURN 凭证）。失败回退 STUN，绝不阻断通话建立。
async function fetchIceConfig() {
  try {
    const { data } = await axios.get('/api/turn/credentials');
    if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
      return { iceServers: data.iceServers };
    }
  } catch { /* 离线/未配 TURN：用兜底 */ }
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

/*
 * 信令状态机
 *
 * 发起方 (outgoing):
 *   init → calling → (对方接受) → createOffer → connected | ended
 *
 * 接听方 (incoming):
 *   incoming → (用户接受) → connecting → (收到 offer + answer) → connected | ended
 *
 * 修复要点：发起方在收到 call:response(accepted=true) 之后才创建并发送 offer，
 * 确保接听方的 RTCPeerConnection 已就绪时 offer 才到达，彻底消除竞态。
 * 同时用 pendingOfferRef 缓冲极端网络延迟下提前到达的 offer。
 */
export default function CallModal({ socket, user, call, onClose }) {
  const { type, direction, remoteUser, remoteId } = call;

  const [status, setStatus]     = useState(direction === 'incoming' ? 'incoming' : 'calling');
  const [muted, setMuted]       = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [endReason, setEndReason] = useState('');

  const pcRef              = useRef(null);
  const localStreamRef     = useRef(null);
  const localVideoRef      = useRef(null);
  const remoteVideoRef     = useRef(null);
  const remoteAudioRef     = useRef(null);
  const pendingOfferRef    = useRef(null); // 缓冲提前到达的 offer
  const timeoutRef         = useRef(null);
  const disconnectTimerRef = useRef(null); // 网络抖动恢复等待 timer
  const statusRef          = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  // ── 清理所有资源 ──────────────────────────────────────────────
  const cleanup = useCallback(() => {
    clearTimeout(timeoutRef.current);
    clearTimeout(disconnectTimerRef.current);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    if (pcRef.current) {
      pcRef.current.onicecandidate       = null;
      pcRef.current.ontrack              = null;
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

  // ── 建立 RTCPeerConnection + 获取本地媒体流 ──────────────────
  const initPC = useCallback(async () => {
    const constraints = { audio: true, video: type === 'video' };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      stream = new MediaStream(); // 无权限时用空流，避免崩溃
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
        // 网络短暂抖动（Wi-Fi 切换等），等 5s 自恢复再挂断
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

  // ── 处理收到的 offer ──────────────────────────────────────────
  const processOffer = useCallback(async (offer) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket?.emit('call:answer', { to: remoteId, answer });
    setStatus('connected');
  }, [socket, remoteId]);

  // ── 发起方：准备媒体，等待接受后再发 offer ───────────────────
  const startOutgoing = useCallback(async () => {
    await initPC();
    timeoutRef.current = setTimeout(() => {
      if (statusRef.current === 'calling') endCall(true, 'timeout');
    }, CALL_TIMEOUT_MS);
  }, [initPC, endCall]);

  // ── 接听方：接受 ──────────────────────────────────────────────
  const accept = useCallback(async () => {
    setStatus('connecting');
    await initPC(); // 先建立 PC，确保 offer 到达时 pcRef 已就绪
    socket?.emit('call:response', { to: remoteId, accepted: true });
    // 处理在 initPC 期间提前到达的 offer（极端网络环境）
    if (pendingOfferRef.current) {
      await processOffer(pendingOfferRef.current);
      pendingOfferRef.current = null;
    }
  }, [socket, remoteId, initPC, processOffer]);

  // ── 接听方：拒绝 ──────────────────────────────────────────────
  const reject = useCallback(() => {
    socket?.emit('call:response', { to: remoteId, accepted: false, reason: 'rejected' });
    onClose();
  }, [socket, remoteId, onClose]);

  // ── 监听信令事件 ──────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // 发起方收到：对方接受/拒绝
    const onResponse = async ({ accepted, reason, busy }) => {
      clearTimeout(timeoutRef.current);
      if (!accepted) {
        setEndReason(busy ? 'busy' : (reason || 'rejected'));
        setStatus('ended');
        cleanup();
        setTimeout(onClose, 1500);
        return;
      }
      // 对方已就绪 → 发起方现在才创建并发送 offer
      setStatus('connected');
      const pc = pcRef.current;
      if (!pc) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:offer', { to: remoteId, offer });
    };

    // 接听方收到 offer
    const onOffer = async ({ offer }) => {
      if (!pcRef.current) {
        pendingOfferRef.current = offer; // PC 尚未就绪，缓冲
        return;
      }
      await processOffer(offer);
    };

    // 发起方收到 answer
    const onAnswer = async ({ answer }) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    };

    // ICE 候选
    const onIce = async ({ candidate }) => {
      try {
        if (pcRef.current && candidate)
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    };

    // 对方挂断 / 异常断开
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

  // 发起方：挂载时准备媒体，组件卸载时清理
  // beforeunload：页面刷新/关闭时通知对端结束通话，避免对端卡死 5-30s
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

  // ── 控制按钮 ──────────────────────────────────────────────────
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

  const isVideo = type === 'video';
  const inProgress = ['calling', 'connecting', 'connected'].includes(status);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: isVideo ? '#000' : 'rgba(22,22,22,0.96)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: '#fff',
    }}>
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
      {/* 音频输出 */}
      <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />

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
        {/* 来电：拒绝 + 接听 */}
        {status === 'incoming' && <>
          <CtrlBtn icon="📵"                        label="拒绝" bg="#FA5151" size={64} onClick={reject} />
          <CtrlBtn icon={isVideo ? '📹' : '📞'}    label="接听" bg="var(--green)" size={64} onClick={accept} />
        </>}

        {/* 通话进行中 */}
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
          <CtrlBtn icon="📵" label="挂断" bg="#FA5151" size={64} onClick={() => endCall(true)} />
        </>}
      </div>
    </div>
  );
}

function CtrlBtn({ icon, label, bg, size = 52, onClick }) {
  return (
    <div
      role="button"
      aria-label={label}
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
