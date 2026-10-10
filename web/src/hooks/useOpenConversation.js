import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

const validId = id => typeof id === 'string' && id.trim() && !id.startsWith('__');

/** Only the latest selection in the current view may navigate. */
export function useOpenConversation(onOpen, viewKey = '') {
  const [progress, setProgress] = useState(null);
  const [failure, setFailure] = useState(null);
  const operationRef = useRef(null);
  const mounted = useRef(true);
  const activeView = useRef(viewKey);
  useEffect(() => {
    mounted.current = true;
    activeView.current = viewKey;
    return () => {
      mounted.current = false;
      operationRef.current?.controller.abort();
      operationRef.current = null;
      setProgress(null); setFailure(null);
    };
  }, [viewKey]);

  const run = useCallback(async function openSelected(key, resolve) {
    const scope = captureSession();
    if (!mounted.current || activeView.current !== viewKey || !isSessionCurrent(scope)) return;
    if (operationRef.current?.key === key) return;
    operationRef.current?.controller.abort();
    const operation = { key, controller: new AbortController() };
    operationRef.current = operation;
    const current = () => mounted.current && operationRef.current === operation && isSessionCurrent(scope);
    setProgress({ viewKey, key });
    setFailure(previous => previous?.viewKey === viewKey && previous.key === key ? previous : null);
    try {
      const conversation = await resolve({ signal: operation.controller.signal, _sessionContext: scope });
      if (!current()) return;
      if (!validId(conversation?.id)) throw new Error('Invalid conversation');
      setFailure(null);
      onOpen(conversation);
    } catch {
      if (current()) setFailure({ viewKey, key, retry: () => openSelected(key, resolve) });
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        setProgress(null);
      }
    }
  }, [onOpen, viewKey]);

  const openContact = contact => run(`contact:${contact.id}`, async config => {
    if (!validId(contact.id)) throw new Error('Invalid contact');
    const { data } = await axios.post('/api/messages/conversation/private', { userId: contact.id }, config);
    return { id: data?.conversationId, type: 'private', name: contact.remark || contact.name || contact.username,
      avatar: contact.avatar || '', otherUser: { ...contact, username: contact.username || contact.name } };
  });
  const openConversation = conversation => run(`conversation:${conversation.id || conversation.type}${conversation.scrollToId ? `:message:${conversation.scrollToId}` : ''}`, async config => {
    if (conversation.type === 'filehelper' && !validId(conversation.id)) {
      const { data } = await axios.get('/api/messages/file-helper', config);
      return { ...conversation, id: data?.conversationId };
    }
    return conversation;
  });
  const visibleFailure = failure?.viewKey === viewKey ? failure : null;
  const openingKey = progress?.viewKey === viewKey ? progress.key : null;
  return {
    openingKey,
    error: !!visibleFailure && !openingKey,
    retry: visibleFailure?.retry,
    openContact, openConversation,
  };
}
