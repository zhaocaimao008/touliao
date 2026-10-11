import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import axios from 'axios';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';
import { datetimeLocalToUnix, scheduleTimeError } from '../utils/scheduleSend';

// The form is keyed by conversation/server/account/generation. No response may
// close or consume a draft in a later form, even after switching A -> B -> A.
export function useScheduledMessages({ conversationId, owner, onCreated }) {
  const alive = useRef(null);
  const mutation = useRef(null);
  const listing = useRef(null);
  const uncertain = useRef(false);
  const completed = useRef(false);
  const [state, setState] = useState({ tasks: [], loading: true, listError: false, truncated: false, phase: '', error: '', detail: '', uncertain: false });
  useLayoutEffect(() => {
    alive.current = {};
    return () => { alive.current = null; mutation.current?.controller.abort(); listing.current?.controller.abort(); mutation.current = null; listing.current = null; };
  }, []);
  const getScope = useCallback(() => {
    const scope = captureSession();
    return alive.current && isSessionCurrent(scope) && scope.server === owner?.server && scope.accountId === owner?.accountId && scope.generation === owner?.generation ? scope : null;
  }, [owner?.server, owner?.accountId, owner?.generation]);

  const refresh = useCallback(async () => {
    const scope = getScope();
    if (!scope) return false;
    listing.current?.controller.abort();
    const task = { view: alive.current, controller: new AbortController() };
    listing.current = task;
    const current = () => alive.current === task.view && listing.current === task && isSessionCurrent(scope);
    setState(previous => ({ ...previous, loading: true, listError: false }));
    try {
      const { data } = await axios.get('/api/messages/schedule', { params: { status: 'pending' }, signal: task.controller.signal, _sessionContext: scope });
      if (!current()) return false;
      if (!Array.isArray(data)) throw new Error('Invalid schedule list');
      const tasks = data.filter(item => item?.conversation_id === conversationId && item.sender_id === scope.accountId && ['pending', 'recovery_required'].includes(item.status));
      if (tasks.some(item => typeof item.id !== 'string' || !item.id || typeof item.content !== 'string' || !Number.isFinite(new Date(Number(item.send_at) * 1000).getTime()))) throw new Error('Invalid scheduled task');
      setState(previous => ({ ...previous, tasks, loading: false, listError: false, truncated: data.length >= 100 }));
      return true;
    } catch {
      if (current()) setState(previous => ({ ...previous, loading: false, listError: true }));
      return false;
    } finally {
      if (listing.current === task) {
        listing.current = null;
        if (alive.current === task.view) setState(previous => previous.loading ? { ...previous, loading: false, listError: true } : previous);
      }
    }
  }, [conversationId, getScope]);
  useEffect(() => { refresh(); }, [refresh]);

  const create = async (value, localTime) => {
    const scope = getScope();
    if (!scope || mutation.current || uncertain.current || completed.current) return;
    const content = value.replace(/\r\n?/g, '\n').trim();
    const validation = !content ? 'ss.errEmptyContent' : content.length > 30000 ? 'ss.errContentLong' : scheduleTimeError(localTime);
    if (validation) { setState(previous => ({ ...previous, error: validation, detail: '' })); return; }
    const sendAt = datetimeLocalToUnix(localTime);
    const task = { view: alive.current, controller: new AbortController() };
    mutation.current = task;
    const current = () => alive.current === task.view && mutation.current === task && isSessionCurrent(scope);
    let confirmed = false;
    setState(previous => ({ ...previous, phase: 'creating', error: '', detail: '' }));
    try {
      const { data } = await axios.post('/api/messages/schedule', { conversation_id: conversationId, content, type: 'text', send_at: sendAt }, {
        signal: task.controller.signal, _sessionContext: scope, skipRetry: true,
      });
      if (!current()) return;
      const scheduled = data?.scheduled;
      if (data?.success !== true || !scheduled?.id || scheduled.conversation_id !== conversationId || scheduled.sender_id !== scope.accountId ||
          scheduled.content !== content || Number(scheduled.send_at) !== sendAt || scheduled.status !== 'pending') throw new Error('Unconfirmed schedule');
      confirmed = true;
      completed.current = true;
    } catch (error) {
      if (!current()) return;
      const status = error.response?.status;
      const unknown = !status || status >= 500 || status === 408;
      uncertain.current = unknown;
      setState(previous => ({ ...previous, error: unknown ? 'ss.resultUnconfirmed' : 'ss.createFailed', uncertain: unknown,
        detail: !unknown && typeof error.response?.data?.error === 'string' ? error.response.data.error.slice(0, 300) : '' }));
      if (unknown) refresh();
    } finally {
      if (mutation.current === task) {
        mutation.current = null;
        if (alive.current === task.view) {
          const expired = !isSessionCurrent(scope);
          if (expired) uncertain.current = true;
          setState(previous => ({ ...previous, phase: '', ...(expired ? { error: 'ss.resultUnconfirmed', uncertain: true } : {}) }));
        }
      }
    }
    if (confirmed && alive.current === task.view && isSessionCurrent(scope)) onCreated?.(content);
  };

  const cancel = async id => {
    const scope = getScope();
    if (!scope || mutation.current || !state.tasks.some(item => item.id === id)) return;
    const task = { view: alive.current, controller: new AbortController() };
    mutation.current = task;
    const current = () => alive.current === task.view && mutation.current === task && isSessionCurrent(scope);
    setState(previous => ({ ...previous, phase: id, error: '', detail: '' }));
    try {
      const { data } = await axios.delete(`/api/messages/schedule/${encodeURIComponent(id)}`, { signal: task.controller.signal, _sessionContext: scope, skipRetry: true });
      if (!current()) return;
      if (data?.success !== true) throw new Error('Unconfirmed cancellation');
      // A list requested before cancellation must not resurrect the removed task.
      listing.current?.controller.abort(); listing.current = null;
      setState(previous => ({ ...previous, tasks: previous.tasks.filter(item => item.id !== id), loading: false }));
    } catch (error) {
      if (current()) {
        setState(previous => ({ ...previous, error: 'ss.cancelFailed', detail: typeof error.response?.data?.error === 'string' ? error.response.data.error.slice(0, 300) : '' }));
        refresh();
      }
    } finally {
      if (mutation.current === task) {
        mutation.current = null;
        if (alive.current === task.view) setState(previous => ({ ...previous, phase: '', ...(!isSessionCurrent(scope) ? { error: 'ss.cancelFailed' } : {}) }));
      }
    }
  };
  const acknowledge = () => {
    if (mutation.current || state.loading || state.listError) return;
    uncertain.current = false;
    setState(previous => ({ ...previous, uncertain: false, error: '', detail: '' }));
  };
  const clearError = () => {
    if (!mutation.current && !uncertain.current) setState(previous => ({ ...previous, error: '', detail: '' }));
  };
  return { state, create, refresh, cancel, acknowledge, clearError, canClose: () => !mutation.current };
}
