import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

const listData = data => data;

/** Keep confirmed directory data visible while a newer request is pending or fails. */
export function useDirectoryResource(url, select = listData) {
  const [state, setState] = useState({ data: [], loading: true, loaded: false, error: false });
  const requestRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestRef.current?.controller.abort(); requestRef.current = null; };
  }, []);

  const reload = useCallback(async () => {
    const scope = captureSession();
    if (!mounted.current || !isSessionCurrent(scope)) return;
    requestRef.current?.controller.abort();
    const request = { controller: new AbortController() };
    requestRef.current = request;
    const current = () => mounted.current && requestRef.current === request && isSessionCurrent(scope);
    setState(previous => ({ ...previous, loading: true, error: false }));
    try {
      const response = await axios.get(url, { signal: request.controller.signal, _sessionContext: scope });
      if (!current()) return;
      const data = select(response.data);
      if (!Array.isArray(data)) throw new Error('Invalid directory response');
      setState({ data, loading: false, loaded: true, error: false });
    } catch {
      if (current()) setState(previous => ({ ...previous, loading: false, error: true }));
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }, [url, select]);

  const setData = useCallback(update => setState(previous => ({ ...previous,
    data: typeof update === 'function' ? update(previous.data) : update,
  })), []);
  return { ...state, reload, setData, emptyReady: state.loaded && !state.loading && !state.error };
}
