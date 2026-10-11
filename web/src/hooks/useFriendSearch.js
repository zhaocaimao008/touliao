import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

const validUser = user => user && typeof user.id === 'string' && user.id.trim() && typeof user.username === 'string';

export function useFriendSearch(initialQuery = '') {
  const [state, setState] = useState({ query: initialQuery, results: [], status: 'idle' });
  const taskRef = useRef(null);
  const cancel = useCallback(() => {
    const task = taskRef.current;
    taskRef.current = null;
    clearTimeout(task?.timer);
    task?.controller.abort();
  }, []);
  const search = useCallback((query, { immediate = false, composing = false } = {}) => {
    const value = query.trim();
    if (immediate && taskRef.current?.started && taskRef.current.query === value) return;
    cancel();
    setState({ query, results: [], status: value ? (composing ? 'composing' : 'loading') : 'idle' });
    if (!value || composing) return;
    const task = { query: value, scope: captureSession(), controller: new AbortController() };
    taskRef.current = task;
    const current = () => taskRef.current === task && isSessionCurrent(task.scope);
    const load = async () => {
      if (!current()) return;
      task.started = true;
      try {
        const { data } = await axios.get(`/api/users/search?q=${encodeURIComponent(value)}`, {
          signal: task.controller.signal, _sessionContext: task.scope,
        });
        if (!current()) return;
        if (!Array.isArray(data) || !data.every(validUser)) throw new Error('Invalid search response');
        setState({ query, results: data, status: 'success' });
      } catch {
        if (current()) setState({ query, results: [], status: 'error' });
      } finally {
        if (taskRef.current === task) taskRef.current = null;
      }
    };
    if (immediate) void load();
    else task.timer = setTimeout(load, 350);
  }, [cancel]);
  useEffect(() => {
    // Synchronize a supplied lookup with the external search service.
    search(initialQuery, { immediate: true });
    return cancel;
  }, [initialQuery, search, cancel]);
  return { ...state, search };
}
