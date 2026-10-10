import { useCallback, useEffect, useRef, useState } from 'react';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

/** Serialize writes, including confirmation, while keeping their UI tied to its original view. */
export function useDirectoryAction(viewKey) {
  const [pendingKey, setPendingKey] = useState(null);
  const [failure, setFailure] = useState(null);
  const [view, setView] = useState({ key: viewKey });
  if (view.key !== viewKey) setView({ key: viewKey });
  const operationRef = useRef(null);
  const mounted = useRef(true);
  const activeView = useRef(null);
  useEffect(() => {
    activeView.current = view;
    return () => { if (activeView.current === view) activeView.current = null; };
  }, [view]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operationRef.current?.controller.abort();
      operationRef.current = null;
    };
  }, []);

  const run = useCallback(async ({ key, request, confirm, commit, onSuccess, reconcile }) => {
    const scope = captureSession();
    if (!mounted.current || activeView.current !== view || !isSessionCurrent(scope) || operationRef.current) return false;
    const operation = { controller: new AbortController() };
    operationRef.current = operation;
    const owned = () => mounted.current && operationRef.current === operation && isSessionCurrent(scope);
    const visible = () => owned() && activeView.current === view;
    setPendingKey(key); setFailure(null);
    try {
      if (confirm && (!await confirm() || !visible())) return false;
      if (!visible()) return false;
      const result = await request({ signal: operation.controller.signal, _sessionContext: scope });
      if (!owned()) return false;
      // An acknowledged write still updates the directory after the user leaves its subview.
      commit?.(result);
      if (visible()) onSuccess?.(result);
      return true;
    } catch {
      if (visible()) setFailure({ view });
      // A lost response may have reached the server. Read back instead of replaying the write.
      if (owned()) {
        try { await reconcile?.(); } catch { /* The resource owns read-back failure feedback. */ }
      }
      return false;
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        if (mounted.current) setPendingKey(null);
      }
    }
  }, [view]);
  // The generation object also invalidates feedback after a leave-and-return round trip.
  return { pendingKey, error: failure?.view === view && view.key === viewKey && !pendingKey, run };
}
