import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

/** Mounted inside a card keyed by user ID, so drafts and requests never cross targets. */
export function useProfileResource(userId) {
  const [state, setState] = useState({ user: null, loading: true, error: false });
  const requestRef = useRef(null);
  const cancel = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
  }, []);
  const reload = useCallback(async () => {
    cancel();
    const request = { scope: captureSession(), controller: new AbortController() };
    requestRef.current = request;
    const current = () => requestRef.current === request && isSessionCurrent(request.scope);
    if (!current()) return;
    setState(previous => ({ ...previous, loading: true, error: false }));
    try {
      const { data } = await axios.get(`/api/users/${userId}`, {
        signal: request.controller.signal, _sessionContext: request.scope,
      });
      if (!current()) return;
      if (!data || data.id !== userId || typeof data.username !== 'string') throw new Error('Invalid profile response');
      setState({ user: data, loading: false, error: false });
    } catch {
      if (current()) setState(previous => ({ ...previous, loading: false, error: true }));
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }, [userId, cancel]);
  useEffect(() => {
    void reload();
    return cancel;
  }, [reload, cancel]);
  const commit = useCallback(update => {
    cancel();
    setState(previous => ({ user: update(previous.user), loading: false, error: false }));
  }, [cancel]);
  return { ...state, reload, commit };
}
