import React, { useState, useRef, useEffect } from 'react';

export default function VoicePlayer({ url }) {
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const audioRef = useRef(null);

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play().catch(() => {});
  };

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audioRef.current && duration) {
      audioRef.current.currentTime = pct * duration;
      setCurrentTime(pct * duration);
    }
  };

  useEffect(() => {
    const audio = new Audio(url);
    audio.preload = 'metadata';
    const onMeta  = () => { setDuration(audio.duration || 0); setLoaded(true); };
    const onTime  = () => setCurrentTime(audio.currentTime);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    const onPlay  = () => setPlaying(true);
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
  }, [url]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

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
        onKeyDown={e => {
          if (!audioRef.current || !duration) return;
          const step = duration * 0.05;
          if (e.key === 'ArrowRight') { audioRef.current.currentTime = Math.min(duration, currentTime + step); e.preventDefault(); }
          if (e.key === 'ArrowLeft')  { audioRef.current.currentTime = Math.max(0, currentTime - step); e.preventDefault(); }
        }}
      >
        <div className="wc-voice-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="wc-voice-duration">
        {loaded ? `${fmt(currentTime)} / ${fmt(duration)}` : '--:--'}
      </span>
    </div>
  );
}
