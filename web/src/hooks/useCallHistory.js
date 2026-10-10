import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

export const canOpenCall = call => Boolean(call?.kind === 'group' ? call.conversation_id : call?.peer_id);

export default function useCallHistory(refreshKey, onOpenChat) {
  const [state, setState] = useState({ list: [], loading: true, loadError: false });
  const [retryKey, setRetryKey] = useState(0);
  const [openingId, setOpeningId] = useState(null);
  const [openErrorId, setOpenErrorId] = useState(null);
  const loadRef = useRef(null);
  const openRef = useRef(null);

  // Initial load, event refresh and manual retry share the same request owner.
  useEffect(() => {
    const controller = new AbortController();
    const scope = captureSession();
    loadRef.current = controller;
    const current = () => !controller.signal.aborted && isSessionCurrent(scope);
    axios.get('/api/users/me/call-logs', { signal: controller.signal, _sessionContext: scope })
      .then(({ data }) => {
        if (!current()) return;
        if (!Array.isArray(data) || data.some(call => !call || !call.id)) throw new Error('Invalid call history');
        setState({ list: data, loading: false, loadError: false });
      })
      .catch(() => { if (current()) setState(previous => ({ ...previous, loading: false, loadError: true })); })
      .finally(() => { if (loadRef.current === controller) loadRef.current = null; });
    return () => { controller.abort(); if (loadRef.current === controller) loadRef.current = null; };
  }, [refreshKey, retryKey]);

  useEffect(() => () => { openRef.current?.controller.abort(); openRef.current = null; }, []);
  const retry = useCallback(() => {
    if (loadRef.current) return;
    setState(previous => ({ ...previous, loading: true, loadError: false }));
    setRetryKey(value => value + 1);
  }, []);

  const openPeer = useCallback(async call => {
    if (!onOpenChat || !canOpenCall(call) || openRef.current) return;
    const scope = captureSession();
    if (!isSessionCurrent(scope)) return;
    const operation = { controller: new AbortController() };
    openRef.current = operation;
    const current = () => openRef.current === operation && isSessionCurrent(scope);
    setOpeningId(call.id); setOpenErrorId(null);
    try {
      if (call.kind === 'group') {
        onOpenChat({ id: call.conversation_id, type: 'group', name: call.peer_name, avatar: call.peer_avatar });
      } else {
        const { data } = await axios.post('/api/messages/conversation/private', { userId: call.peer_id }, {
          signal: operation.controller.signal, _sessionContext: scope,
        });
        if (!current()) return;
        if (!data?.conversationId) throw new Error('Missing conversation');
        onOpenChat({ id: data.conversationId, type: 'private', name: call.peer_name, avatar: call.peer_avatar,
          otherUser: { id: call.peer_id, username: call.peer_name, avatar: call.peer_avatar } });
      }
    } catch {
      if (current()) setOpenErrorId(call.id);
    } finally {
      if (openRef.current === operation) { openRef.current = null; setOpeningId(null); }
    }
  }, [onOpenChat]);
  return { ...state, retry, openingId, openErrorId, openPeer };
}
