import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import axios from 'axios';
import Avatar from './Avatar';
import { mediaUrl } from '../utils/url';
import { showToast } from '../utils/toast';

/**
 * 「扫一扫」入群：登录后主动扫群二维码。
 * 群二维码内容为 {appUrl}/join/{token}，扫到后解析出 token，
 * 拉取群预览信息 → 用户点「加入群聊」确认后才入群（不自动进群）。
 *
 * Props:
 *   onClose(convId?) — 关闭；带 convId 时表示已入群，父级据此打开会话
 */
export default function ScanQR({ onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const scannedRef = useRef(false); // 命中一次后停止扫描
  const [phase, setPhase] = useState('scanning'); // scanning | preview | joining | error
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null); // { token, conversationId, name, avatar, memberCount, alreadyMember }

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  // 从扫到的文本里提取 join token：支持完整 URL(/join/xxx) 或裸 token
  const extractToken = (text) => {
    if (!text) return '';
    const m = String(text).match(/\/join\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    // 裸 token（无 URL）：仅接受合理字符集，避免误判其它二维码
    if (/^[A-Za-z0-9_-]{8,}$/.test(text.trim())) return text.trim();
    return '';
  };

  const handleDecoded = useCallback(async (text) => {
    const token = extractToken(text);
    if (!token) {
      setError('这不是有效的群二维码');
      setPhase('error');
      stopCamera();
      return;
    }
    stopCamera();
    try {
      const { data } = await axios.get(`/api/messages/join/${token}/preview`);
      setInfo({ ...data, token });
      setPhase('preview');
    } catch (e) {
      setError(e.response?.data?.error || '邀请无效或已过期');
      setPhase('error');
    }
  }, [stopCamera]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const tick = () => {
          if (scannedRef.current) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code && code.data) {
              scannedRef.current = true;
              handleDecoded(code.data);
              return;
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) {
          setError('无法访问摄像头，请检查权限');
          setPhase('error');
        }
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, [handleDecoded, stopCamera]);

  const confirmJoin = async () => {
    if (phase === 'joining' || !info) return;
    setPhase('joining');
    try {
      const { data } = await axios.post(`/api/messages/join/${info.token}`);
      showToast(data.alreadyMember ? '你已在群里' : '已加入群聊', 'success');
      onClose(data.conversationId);
    } catch (e) {
      setError(e.response?.data?.error || '加入失败，请重试');
      setPhase('error');
    }
  };

  return (
    <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="扫一扫"
        style={{ width: 'min(400px, 92vw)', background: 'var(--bg-panel, #fff)', borderRadius: 'var(--radius-lg, 16px)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div className="wc-modal-header">
          <span className="wc-modal-title">扫一扫</span>
          <button className="wc-modal-close" onClick={() => onClose()} aria-label="关闭">✕</button>
        </div>

        {phase === 'scanning' && (
          <div style={{ position: 'relative', background: '#000' }}>
            <video ref={videoRef} style={{ width: '100%', display: 'block', maxHeight: '60vh', objectFit: 'cover' }} muted />
            {/* 取景框 */}
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              <div style={{ width: '62%', aspectRatio: '1', border: '2px solid rgba(255,255,255,.85)', borderRadius: 12 }} />
            </div>
            <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,.9)', fontSize: 'var(--text-sm2, 14px)', pointerEvents: 'none' }}>
              将群二维码放入框内
            </div>
          </div>
        )}

        {(phase === 'preview' || phase === 'joining') && info && (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <Avatar src={info.avatar ? mediaUrl(info.avatar) : ''} name={info.name} size={64} style={{ borderRadius: 'var(--radius-lg, 16px)' }} />
            <div style={{ fontSize: 'var(--text-lg, 18px)', fontWeight: 600, color: 'var(--text-primary, #191919)' }}>{info.name || '群聊'}</div>
            <div style={{ fontSize: 'var(--text-sm2, 14px)', color: 'var(--text-tertiary, #999)' }}>
              {info.memberCount ? `${info.memberCount} 位成员` : '群聊邀请'}
            </div>
            <button
              onClick={confirmJoin}
              disabled={phase === 'joining'}
              style={{
                marginTop: 6, padding: '10px 40px', border: 'none', borderRadius: 'var(--radius-2xl, 20px)',
                background: 'var(--green, #6D5AE6)', color: '#fff', fontSize: 'var(--text-base, 15px)',
                cursor: phase === 'joining' ? 'default' : 'pointer', opacity: phase === 'joining' ? 0.7 : 1,
              }}
            >{phase === 'joining' ? '加入中…' : (info.alreadyMember ? '进入群聊' : '加入群聊')}</button>
          </div>
        )}

        {phase === 'error' && (
          <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 'var(--text-md, 16px)', color: 'var(--text-primary, #191919)', textAlign: 'center' }}>{error}</div>
            <button
              onClick={() => onClose()}
              style={{
                padding: '8px 24px', border: 'none', borderRadius: 'var(--radius-2xl, 20px)',
                background: 'var(--green, #6D5AE6)', color: '#fff', fontSize: 'var(--text-base, 15px)', cursor: 'pointer',
              }}
            >关闭</button>
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
