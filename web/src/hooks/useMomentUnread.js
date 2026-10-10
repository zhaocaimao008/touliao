import { useEffect, useState } from 'react';
import axios from 'axios';

/** Disabled/unknown features do no work; only the latest refresh may update the badge. */
export default function useMomentUnread(enabled, refreshKey) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let request;
    const load = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      axios.get('/api/moments/notifications/unread-count', { signal: controller.signal })
        .then(({ data }) => {
          if (!controller.signal.aborted) setCount(Math.max(0, Number(data?.count) || 0));
        })
        .catch(() => { if (!controller.signal.aborted) setCount(0); });
    };
    load();
    window.addEventListener('touliao:moment', load);
    return () => {
      request?.abort();
      window.removeEventListener('touliao:moment', load);
    };
  }, [enabled, refreshKey]);
  return enabled ? count : 0;
}
