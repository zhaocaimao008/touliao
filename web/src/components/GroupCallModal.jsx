import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Avatar from './Avatar';

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

/**
 * 群音视频通话（mesh）。信令协议见 backend-v2/docs/GROUP_CALL.md。
 *
 * props:
 *   socket, user
 *   session: { mode:'start'|'join', conversationId, type:'audio'|'video', callId?(join) }
 *   nameOf(userId) -> { name, avatar } | undefined  （可选，用于显示成员名）
 *   onClose()
 *
 * 防 glare：新加入者只 answer；既有成员收到 peer_joined 后才向其 createOffer。
 */
export default function GroupCallModal({ socket, user, session, nameOf, onClose }) {
  const { mode, conversationId, type } = session;
  const isVideo = type === 'video';

  const [callId, setCallId]   = useState(session.callId || null);
  const [muted, setMuted]     = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({}); // peerId -> MediaStream
  const [status, setStatus]   = useState(mode === 'start' ? 'calling' : 'joining');

  const localStreamRef = useRef(null);
  const localVideoRef  = useRef(null);
  const iceCfgRef      = useRef(FALLBACK_ICE);
  const pcsRef         = useRef(new Map());      // peerId -> RTCPeerConnection
  const remoteSetRef   = useRef(new Set());      // 已 setRemoteDescription 的 peerId
  const pendingIceRef  = useRef(new Map());      // peerId -> [candidate]
  const callIdRef      = useRef(session.callId || null);
  const closedRef      = useRef(false);

  // ── 清理 ──────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (callIdRef.current) socket?.emit('group_call:leave', { callId: callIdRef.current });
    pcsRef.current.forEach(pc => { try { pc.onicecandidate = null; pc.ontrack = null; pc.close(); } catch {} });
    pcsRef.current.clear();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
  }, [socket]);

  const hangup = useCallback(() => { cleanup(); onClose(); }, [cleanup, onClose]);

  // ── 建立到某 peer 的连接 ─────────────────────────────────────
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
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) removePeer(peerId);
    };
    return pc;
  }, [socket]);

  const drainIce = useCallback((peerId) => {
    const pc = pcsRef.current.get(peerId);
    const pending = pendingIceRef.current.get(peerId);
    if (pc && pending) { pending.forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})); pendingIceRef.current.delete(peerId); }
  }, []);

  const removePeer = useCallback((peerId) => {
    const pc = pcsRef.current.get(peerId);
    if (pc) { try { pc.close(); } catch {} pcsRef.current.delete(peerId); }
    remoteSetRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    setRemoteStreams(prev => { if (!(peerId in prev)) return prev; const n = { ...prev }; delete n[peerId]; return n; });
  }, []);

  // ── 初始化媒体 + 信令 ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo }); }
      catch { stream = new MediaStream(); }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      iceCfgRef.current = await fetchIceConfig();
      if (cancelled) return;

      if (mode === 'start') socket?.emit('group_call:start', { conversationId, type });
      else                  socket?.emit('group_call:join', { callId: callIdRef.current });
    })();
    return () => { cancelled = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 信令事件 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onStarted = ({ callId: cid }) => { callIdRef.current = cid; setCallId(cid); setStatus('connected'); };

    const onPeers = async ({ callId: cid, peers }) => {
      callIdRef.current = cid; setCallId(cid); setStatus('connected');
      peers.forEach(pid => createPC(pid));   // 作为 answerer 预建，等对方 offer
    };

    const onPeerJoined = async ({ userId: pid }) => {
      const pc = createPC(pid);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('group_call:offer', { callId: callIdRef.current, to: pid, offer });
    };

    const onOffer = async ({ from, offer }) => {
      const pc = createPC(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteSetRef.current.add(from); drainIce(from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('group_call:answer', { callId: callIdRef.current, to: from, answer });
    };

    const onAnswer = async ({ from, answer }) => {
      const pc = pcsRef.current.get(from);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      remoteSetRef.current.add(from); drainIce(from);
    };

    const onIce = ({ from, candidate }) => {
      const pc = pcsRef.current.get(from);
      if (pc && remoteSetRef.current.has(from)) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      else { const arr = pendingIceRef.current.get(from) || []; arr.push(candidate); pendingIceRef.current.set(from, arr); }
    };

    const onPeerLeft = ({ userId: pid }) => removePeer(pid);
    const onError = ({ reason }) => {
      const msg = { busy: '你正在通话中', not_group: '仅群聊支持多人通话', not_found: '通话已结束', full: '通话人数已满' }[reason] || '通话出错';
      alert(msg); hangup();
    };

    socket.on('group_call:started', onStarted);
    socket.on('group_call:peers', onPeers);
    socket.on('group_call:peer_joined', onPeerJoined);
    socket.on('group_call:offer', onOffer);
    socket.on('group_call:answer', onAnswer);
    socket.on('group_call:ice', onIce);
    socket.on('group_call:peer_left', onPeerLeft);
    socket.on('group_call:error', onError);
    return () => {
      socket.off('group_call:started', onStarted);
      socket.off('group_call:peers', onPeers);
      socket.off('group_call:peer_joined', onPeerJoined);
      socket.off('group_call:offer', onOffer);
      socket.off('group_call:answer', onAnswer);
      socket.off('group_call:ice', onIce);
      socket.off('group_call:peer_left', onPeerLeft);
      socket.off('group_call:error', onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // ── 控制 ─────────────────────────────────────────────────────
  const toggleMute = () => {
    const on = !muted; setMuted(on);
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !on; });
  };
  const toggleCamera = () => {
    const off = !cameraOff; setCameraOff(off);
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !off; });
  };

  const peerIds = Object.keys(remoteStreams);
  const tileCount = peerIds.length + 1;
  const cols = tileCount <= 1 ? 1 : tileCount <= 4 ? 2 : 3;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(18,18,18,0.97)', display: 'flex', flexDirection: 'column', color: 'var(--text-inverse)' }}>
      <div style={{ textAlign: 'center', padding: '14px 0 6px', fontSize: 15, color: 'rgba(255,255,255,.85)' }}>
        群{isVideo ? '视频' : '语音'}通话 · {tileCount} 人
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginLeft: 8 }}>
          {status === 'connected' ? '通话中' : (mode === 'start' ? '等待他人加入…' : '加入中…')}
        </span>
      </div>

      {/* 画面宫格 */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6, padding: 10, alignContent: 'center', overflow: 'auto' }}>
        <Tile stream={localStreamRef.current} muted isVideo={isVideo && !cameraOff} info={{ name: '我', avatar: user?.avatar }} self />
        {peerIds.map(pid => (
          <Tile key={pid} streamForRef={remoteStreams[pid]} isVideo={isVideo} info={nameOf?.(pid) || { name: '成员' }} />
        ))}
      </div>

      {/* 控制区 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 28, padding: '18px 0 34px' }}>
        {isVideo && <CtrlBtn icon={cameraOff ? '📷' : '📹'} label={cameraOff ? '开摄像头' : '关摄像头'} bg={cameraOff ? '#555' : 'rgba(255,255,255,.18)'} onClick={toggleCamera} />}
        <CtrlBtn icon={muted ? '🔇' : '🎙️'} label={muted ? '取消静音' : '静音'} bg="rgba(255,255,255,.18)" onClick={toggleMute} />
        <CtrlBtn icon="📵" label="挂断" bg="var(--color-badge)" size={64} onClick={hangup} />
      </div>
    </div>
  );
}

// 单路画面：本地用 ref 直挂，远端用 streamForRef 通过 effect 挂载
function Tile({ stream, streamForRef, muted, isVideo, info, self }) {
  const ref = useRef(null);
  const s = stream || streamForRef;
  useEffect(() => { if (ref.current && s) ref.current.srcObject = s; }, [s]);
  return (
    <div style={{ position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden', minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', border: self ? '2px solid var(--green,#07C160)' : '1px solid rgba(255,255,255,.08)' }}>
      <video ref={ref} autoPlay playsInline muted={muted}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: isVideo ? 'block' : 'none' }} />
      {!isVideo && <Avatar src={info?.avatar} name={info?.name || '?'} size={72} style={{ borderRadius: 16 }} />}
      <div style={{ position: 'absolute', bottom: 6, left: 8, fontSize: 12, color: 'var(--text-inverse)', textShadow: '0 1px 3px rgba(0,0,0,.6)' }}>{info?.name}</div>
    </div>
  );
}

function CtrlBtn({ icon, label, bg, size = 52, onClick }) {
  return (
    <div role="button" aria-label={label} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick(e)} onClick={onClick}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <div style={{ width: size, height: size, borderRadius: size / 2, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42 }}>{icon}</div>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>{label}</span>
    </div>
  );
}
