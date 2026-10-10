import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { showConfirm } from '../utils/toast';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

export const MAX_BATCH_RECALL = 20;

/** A confirmation and its request share one lock and one account/view owner. */
export default function useBatchRecall({ conversationId, t, onComplete, onReconcile }) {
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const operationRef = useRef(null);
  useEffect(() => () => {
    operationRef.current?.controller.abort();
    operationRef.current = null;
  }, [conversationId]);
  const isPending = useCallback(() => operationRef.current !== null, []);
  const clearError = useCallback(() => setError(''), []);
  const run = useCallback(async selectedIds => {
    if (operationRef.current) return;
    const ids = [...new Set(selectedIds)];
    if (!ids.length || ids.length > MAX_BATCH_RECALL) return;
    const scope = captureSession();
    if (!isSessionCurrent(scope)) return;
    const operation = { controller: new AbortController() };
    operationRef.current = operation;
    const current = () => operationRef.current === operation && isSessionCurrent(scope);
    setPhase('confirming'); setError('');
    try {
      const confirmed = await showConfirm(t('chat.confirmBatchRecallDeleteTemplate').replace('{count}', ids.length), { variant: 'DANGER' });
      if (!confirmed || !current()) return;
      setPhase('sending');
      const { data } = await axios.post('/api/messages/batch-delete', { msgIds: ids, conversationId }, {
        signal: operation.controller.signal, _sessionContext: scope,
      });
      if (!current()) return;
      if (data?.success !== true || !Number.isInteger(data.deleted) || data.deleted < 0 || data.deleted > ids.length) {
        throw new Error('Invalid batch recall response');
      }
      // The API returns a count, not IDs: never guess which messages succeeded.
      if (data.deleted === ids.length) onComplete(ids);
      else {
        setError(t('multiSelect.partialRecall').replace('{done}', data.deleted).replace('{total}', ids.length));
        onReconcile?.();
      }
    } catch (failure) {
      if (current()) {
        setError(failure.response?.data?.error || t('multiSelect.recallFailed'));
        // A response can be lost after the server applies a change.
        onReconcile?.();
      }
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        setPhase('idle');
      }
    }
  }, [conversationId, t, onComplete, onReconcile]);
  return { phase, busy: phase !== 'idle', error, clearError, isPending, run };
}
