import { useCallback, useEffect, useRef, useState } from 'react';
import { createCallAudioOutput } from '../utils/callAudioOutput';

export default function useCallAudioOutput(mediaReady) {
  const supported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  const canChoose = supported && typeof navigator.mediaDevices?.selectAudioOutput === 'function';
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [unplugged, setUnplugged] = useState(false);
  const active = useRef(true);
  const operation = useRef(0);
  const [router] = useState(() => createCallAudioOutput({
    onChange: setSelected,
    onError: () => setError(true),
  }));
  useEffect(() => () => { active.current = false; router.dispose(); }, [router]);

  const select = useCallback(async id => {
    const attempt = ++operation.current;
    setPending(true); setError(false); setUnplugged(false);
    try {
      await router.select(id);
      if (active.current && attempt === operation.current) setError(false);
      return active.current;
    }
    catch { return false; }
    finally { if (active.current && attempt === operation.current) setPending(false); }
  }, [router]);

  useEffect(() => {
    if (!supported || !navigator.mediaDevices?.enumerateDevices) return;
    let disposed = false;
    let sequence = 0;
    const refresh = async () => {
      const generation = ++sequence;
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (disposed || generation !== sequence) return;
        const outputs = list.filter(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default');
        setDevices(outputs);
        if (router.selected && !outputs.some(device => device.deviceId === router.selected)) {
          const restored = await select('');
          if (!disposed && restored) setUnplugged(true);
        }
      } catch { if (!disposed) setError(true); }
    };
    refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => { disposed = true; navigator.mediaDevices.removeEventListener?.('devicechange', refresh); };
  }, [supported, mediaReady, router, select]);

  const choose = async () => {
    // Keep the browser's picker in the user's click/keyboard activation.
    try {
      const device = await navigator.mediaDevices.selectAudioOutput();
      if (!active.current) return;
      setDevices(list => [...list.filter(item => item.deviceId !== device.deviceId), device]);
      await select(device.deviceId);
    } catch (error) { if (active.current && error.name !== 'AbortError') setError(true); }
  };
  const register = useCallback(element => router.register(element), [router]);
  return { supported, canChoose, devices, selected, pending, error, unplugged, select, choose, register };
}
