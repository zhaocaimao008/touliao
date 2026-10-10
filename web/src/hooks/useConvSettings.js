import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useI18n } from '../contexts/I18nContext';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';
import { publishConversationSettings } from '../utils/conversationSettings';

const valuesOf = conversation => ({ muted: !!conversation.muted, pinned: !!conversation.pinned, burn_after: Number(conversation.burn_after) || 0 });
const BURN_SECONDS = new Set([0, 10, 30, 60, 300, 3600, 86400, 604800]);

/** A settings panel owns one operation, including any confirmation before it. */
export function useConvSettings(conversation, onConvUpdate) {
  const { t } = useI18n();
  const incoming = valuesOf(conversation);
  const sourceKey = JSON.stringify([conversation.id, incoming]);
  const [snapshot, setSnapshot] = useState(() => ({ id: conversation.id, key: sourceKey, source: incoming, values: incoming }));
  let values = snapshot.values;
  // Apply changed parent fields without reverting a just-acknowledged local
  // setting while the parent is still carrying its previous snapshot.
  if (snapshot.key !== sourceKey) {
    values = snapshot.id !== conversation.id ? incoming : Object.fromEntries(Object.keys(incoming).map(key =>
      [key, incoming[key] !== snapshot.source[key] ? incoming[key] : snapshot.values[key]]));
    setSnapshot({ id: conversation.id, key: sourceKey, source: incoming, values });
  }
  const [progress, setProgress] = useState(null);
  const [failure, setFailure] = useState(null);
  const operationRef = useRef(null);
  useEffect(() => () => {
    operationRef.current?.controller.abort();
    operationRef.current = null;
    setProgress(null); setFailure(null);
  }, [conversation.id]);

  const runAction = useCallback(async (kind, { confirm, request, onSuccess, failureMessage }) => {
    if (operationRef.current) return;
    const scope = captureSession();
    if (!isSessionCurrent(scope)) return;
    const operation = { controller: new AbortController() };
    operationRef.current = operation;
    const current = () => operationRef.current === operation && isSessionCurrent(scope);
    setProgress({ id: conversation.id, kind }); setFailure(null);
    try {
      if (confirm && !await confirm()) return;
      if (!current()) return;
      const result = await request({ signal: operation.controller.signal, _sessionContext: scope });
      if (current()) onSuccess?.(result, scope);
    } catch (error) {
      if (current()) setFailure({ id: conversation.id, text: typeof error.response?.data?.error === 'string' ? error.response.data.error : failureMessage });
    } finally {
      if (operationRef.current === operation) { operationRef.current = null; setProgress(null); }
    }
  }, [conversation.id]);

  const save = (field, value, endpoint, payload) => runAction('save', {
    request: config => axios.post(`/api/messages/conversation/${conversation.id}/${endpoint}`, payload, config),
    failureMessage: t('privateChat.saveFailed'),
    onSuccess: ({ data }, scope) => {
      if (data?.success !== true) throw new Error('Setting was not acknowledged');
      const committed = field === 'burn_after' && data.burn_after !== undefined ? Number(data.burn_after) : value;
      if (field === 'burn_after' && !BURN_SECONDS.has(committed)) throw new Error('Invalid burn setting');
      setSnapshot(previous => ({ ...previous, values: { ...previous.values, [field]: committed } }));
      const patch = { [field]: typeof committed === 'boolean' ? Number(committed) : committed };
      publishConversationSettings(conversation.id, patch, scope);
      onConvUpdate?.(patch);
    },
  });
  const toggleMute = value => save('muted', !!value, 'mute', { muted: value ? 1 : 0 });
  const togglePin = value => save('pinned', !!value, 'pin', { pinned: value ? 1 : 0 });
  const changeBurnAfter = value => {
    const seconds = Number(value);
    if (!BURN_SECONDS.has(seconds) || seconds === values.burn_after) return;
    return save('burn_after', seconds, 'burn-after', { seconds });
  };
  const pending = progress?.id === conversation.id ? progress.kind : null;
  return { muted: values.muted, pinned: values.pinned, burnAfter: values.burn_after,
    saving: !!pending, pending, error: failure?.id === conversation.id ? failure.text : '',
    toggleMute, togglePin, changeBurnAfter, runAction };
}
