import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { composeReducer, initialComposeState } from '../reducers/composeReducer';
import { loadDraft, saveDraft, draftOwnerKey, draftNeedsStorage } from '../utils/chatDrafts';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

const draftText = compose => compose.editingMsg ? compose.suspendedDraft?.input || '' : compose.input;

export function useChatComposer(conversationId, owner) {
  const key = JSON.stringify([draftOwnerKey(owner), owner?.generation, conversationId]);
  const initialize = () => ({ context: { key }, compose: composeReducer(initialComposeState, {
    type: 'RESET', draft: loadDraft(conversationId, owner),
  }), storageFailed: draftNeedsStorage(conversationId, owner) });
  const [model, setModel] = useState(initialize);
  if (model.context.key !== key) setModel(initialize());
  const active = useRef(null);
  useLayoutEffect(() => {
    active.current = model;
    return () => { active.current = null; };
  }, [model]);
  const context = model.context;
  const dispatch = useCallback(action => {
    const current = active.current;
    const session = captureSession();
    if (current?.context !== context || !isSessionCurrent(session) ||
        draftOwnerKey(session) !== draftOwnerKey(owner) || session.generation !== owner?.generation) return;
    const compose = composeReducer(current.compose, action);
    let storageFailed = current.storageFailed;
    if (draftText(compose) !== draftText(current.compose)) {
      storageFailed = !saveDraft(conversationId, draftText(compose), owner);
    }
    const next = { context, compose, storageFailed };
    // Persist before the UI can navigate away; same-tick inserts use the newest input.
    active.current = next;
    setModel(next);
    return compose;
  }, [context, conversationId, owner]);
  return [model.compose, dispatch, model.storageFailed];
}
