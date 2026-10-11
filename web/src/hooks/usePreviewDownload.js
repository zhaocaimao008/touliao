import { useEffect, useRef, useState } from 'react';
import { startDownload, subscribe, cancelDownload, retryDownload } from '../utils/downloadManager';

export default function usePreviewDownload(file) {
  const [state, setState] = useState(null);
  const current = useRef(null);
  const subscription = useRef(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; subscription.current?.(); };
  }, []);
  const busy = () => ['pending', 'downloading'].includes(current.current?.status);
  const start = () => {
    if (!mounted.current || !file.fileUrl || busy()) return;
    current.current = { status: 'pending' };
    subscription.current?.();
    const id = startDownload(file);
    subscription.current = subscribe(id, next => {
      if (!mounted.current) return;
      current.current = next;
      setState(next);
    });
  };
  return {
    state, start,
    cancel: () => { if (mounted.current && busy()) cancelDownload(current.current.id); },
    retry: () => { if (mounted.current && current.current?.status === 'failed') retryDownload(current.current.id); },
  };
}
