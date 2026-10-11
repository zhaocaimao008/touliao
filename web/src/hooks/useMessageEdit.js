import { useLayoutEffect, useRef, useState } from 'react';
import axios from 'axios';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';
import { draftOwnerKey } from '../utils/chatDrafts';

export function useMessageEdit(editor, owner, onSaved) {
  const [state, setState] = useState(null);
  const active = useRef(null);
  const operation = useRef(null);
  useLayoutEffect(() => {
    active.current = editor;
    return () => {
      active.current = null;
      operation.current?.controller.abort();
      operation.current = null;
    };
  }, [editor]);
  const save = async value => {
    const content = value.replace(/\r\n?/g, '\n').trim();
    const scope = captureSession();
    if (!content || !editor || active.current !== editor || operation.current || !isSessionCurrent(scope) ||
        draftOwnerKey(scope) !== draftOwnerKey(owner) || scope.generation !== owner?.generation) return false;
    const task = { controller: new AbortController() };
    operation.current = task;
    const current = () => active.current === editor && operation.current === task && isSessionCurrent(scope);
    setState({ editor, saving: true });
    try {
      const { data } = await axios.put(`/api/messages/${editor.id}/edit`, { content }, {
        signal: task.controller.signal, _sessionContext: scope,
      });
      if (!current()) return false;
      if (data?.success !== true || data.content !== content) throw new Error('Unconfirmed edit');
      setState(null);
      onSaved({ editor, content });
      return true;
    } catch (error) {
      if (current()) setState({ editor, saving: false, error: true,
        detail: typeof error?.response?.data?.error === 'string' ? error.response.data.error.slice(0, 300) : '' });
      return false;
    } finally {
      if (operation.current === task) {
        operation.current = null;
        // Credential rotation can invalidate the response without unmounting this editor.
        setState(previous => previous?.editor === editor && previous.saving
          ? { editor, saving: false, error: true } : previous);
      }
    }
  };
  return { saving: state?.editor === editor && !!state?.saving,
    error: state?.editor === editor && !!state?.error, detail: state?.editor === editor ? state?.detail : '', save };
}
