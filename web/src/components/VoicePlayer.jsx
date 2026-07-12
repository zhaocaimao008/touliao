import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { isVoicePlayed, markVoicePlayed } from '../utils/playedVoice';

const VoicePlayer = memo(function VoicePlayer({ url, msgId = null, isMine = false }) {
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // 「未播放」红点：仅收到的语音(非自己发)且从未播放过才显示(对齐微信)
  const [unplayed, setUnplayed] = useState(() => !isMine && !!msgId && !isVoicePlayed(msgId));
  const audioRef = useRef(null);

  const fmt = (s) => {
    // 某些服务端流式语音会上报 duration=Infinity/NaN,直接算会渲染成「Infinity:NaN」
    if (!Number.isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    // play() 被拒(自动播放策略/解码失败)时 onplay 不会触发,需手动复位 playing 防止图标卡在暂停态
    else audioRef.current.play().catch(() => setPlaying(false));
  }, [playing]);

  const handleSeek = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audioRef.current && duration) {
      audioRef.current.currentTime = pct * duration;
      setCurrentTime(pct * duration);
    }
  }, [duration]);

  useEffect(() => {
    const audio = new Audio(url);
    audio.preload = 'metadata';
    const onMeta  = () => { setDuration(Number.isFinite(audio.duration) ? audio.duration : 0); setLoaded(true); };
    const onTime  = () => setCurrentTime(audio.currentTime);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    const onPlay  = () => {
      setPlaying(true);
      // 首次播放 → 标记已播放、消除红点
      if (!isMine && msgId) { markVoicePlayed(msgId); setUnplayed(false); }
    };
    const onPause = () => setPlaying(false);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = '';
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
    // isMine/msgId 对同一条语音消息恒定（组件按 msgId 挂载），纳入依赖以消除陈旧闭包
  }, [url, isMine, msgId]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const fmtCurrent = fmt(currentTime);
  const fmtDuration = fmt(duration);
  const timeLabel = loaded ? `${fmtCurrent} / ${fmtDuration}` : '--:--';

  const handleKeyDown = useCallback((e) => {
    if (!audioRef.current || !duration) return;
    const step = duration * 0.05;
    if (e.key === 'ArrowRight') { const t = Math.min(duration, currentTime + step); audioRef.current.currentTime = t; setCurrentTime(t); e.preventDefault(); }
    if (e.key === 'ArrowLeft')  { const t = Math.max(0, currentTime - step); audioRef.current.currentTime = t; setCurrentTime(t); e.preventDefault(); }
    if (e.key === 'Home')       { audioRef.current.currentTime = 0; setCurrentTime(0); e.preventDefault(); }
    if (e.key === 'End')        { audioRef.current.currentTime = duration; setCurrentTime(duration); e.preventDefault(); }
  }, [duration, currentTime]);

  return (
    <div className="wc-msg-voice-player wc-voice-player" onClick={e => e.stopPropagation()}>
      <button onClick={togglePlay} className="wc-voice-play-btn" aria-label={playing ? '暂停' : '播放'}>
        {playing ? (
          <svg viewBox="0 0 24 24" className="wc-voice-play-icon">
            <rect x="6" y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="wc-voice-play-icon-offset">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>
      <div
        onClick={handleSeek}
        className="wc-voice-progress-track"
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-valuetext={loaded ? `${fmt(currentTime)} / ${fmt(duration)}` : '未加载'}
        onKeyDown={handleKeyDown}
      >
        <div className="wc-voice-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="wc-voice-duration">
        {timeLabel}
      </span>
      {unplayed && <span className="wc-voice-unplayed-dot" aria-label="未播放" title="未播放" />}
    </div>
  );
});

export default VoicePlayer;
