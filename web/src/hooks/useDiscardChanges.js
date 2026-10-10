import { useEffect, useLayoutEffect, useRef } from 'react';
import { showConfirm } from '../utils/toast';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

export function useDiscardChanges({ dirty, busy, message }) {
  const latest = useRef({ dirty, busy });
  const pending = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => { latest.current = { dirty, busy }; }, [dirty, busy]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  return async leave => {
    if (pending.current || latest.current.busy) return;
    const scope = captureSession();
    pending.current = true;
    try {
      if (latest.current.dirty && !await showConfirm(message)) return;
      if (mounted.current && !latest.current.busy && isSessionCurrent(scope)) leave();
    } finally { pending.current = false; }
  };
}
