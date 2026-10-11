import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { canViewReadStatus, readUserIdsForMessage } from '../utils/readStatus';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

export default function useReadStatus(conversationId, currentUserId) {
  const [state, setState] = useState(null);
  const requestRef = useRef(null);
  const close = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setState(null);
  }, []);
  useEffect(() => close, [conversationId, currentUserId, close]);
  const load = useCallback(async message => {
    if (!conversationId || !canViewReadStatus(message, currentUserId)) return;
    const scope = captureSession();
    if (!isSessionCurrent(scope)) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const current = () => requestRef.current === controller && !controller.signal.aborted && isSessionCurrent(scope);
    const next = { conversationId, message, readUserIds: [], loading: true, error: false };
    setState(next);
    try {
      const messageId = String(message.id);
      const { data } = await axios.get(`/api/messages/conversation/${conversationId}/read-states`, {
        params: { msgIds: messageId }, signal: controller.signal, _sessionContext: scope,
      });
      if (!current()) return;
      const reads = data?.readStates;
      if (!reads || typeof reads !== 'object' || Array.isArray(reads) ||
          (reads[messageId] !== undefined && !Array.isArray(reads[messageId]))) throw new Error('Invalid read status');
      setState({ ...next, readUserIds: readUserIdsForMessage(data, messageId), loading: false });
    } catch {
      if (current()) setState({ ...next, loading: false, error: true });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [conversationId, currentUserId]);
  return { state: state?.conversationId === conversationId ? state : null, load, close };
}
