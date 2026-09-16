import { useEffect, useRef, useState } from 'react';
import { createCallAudioLevels } from '../utils/callAudioLevels';

export default function useCallAudioLevels(localStream, remoteStreams) {
  const [levels, setLevels] = useState({});
  const streamsRef = useRef({});
  useEffect(() => { streamsRef.current = { self: localStream, ...remoteStreams }; }, [localStream, remoteStreams]);
  useEffect(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    let context;
    try { context = new AudioContext(); } catch { return; }
    const monitor = createCallAudioLevels(context, setLevels);
    const resume = () => { if (context.state === 'suspended') context.resume().catch(() => {}); };
    resume();
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    const timer = setInterval(() => { monitor.sync(streamsRef.current); monitor.sample(performance.now()); }, 100);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      monitor.dispose();
      context.close().catch(() => {});
    };
  }, []);
  return levels;
}
