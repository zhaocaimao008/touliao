import { useEffect, useState } from 'react';
import { draftOwnerKey, listDrafts } from '../utils/chatDrafts';

export function useChatDrafts(owner) {
  const key = draftOwnerKey(owner);
  const [state, setState] = useState(() => ({ key, drafts: listDrafts(owner) }));
  if (state.key !== key) setState({ key, drafts: listDrafts(owner) });
  useEffect(() => {
    const onDraft = event => {
      const { owner: changedOwner, convId, text } = event.detail || {};
      if (changedOwner !== key || !convId || typeof text !== 'string') return;
      setState(previous => {
        if (previous.key !== key) return previous;
        const drafts = { ...previous.drafts };
        if (text) drafts[convId] = text;
        else delete drafts[convId];
        return { key, drafts };
      });
    };
    const refresh = () => setState({ key, drafts: listDrafts(owner) });
    window.addEventListener('draft-changed', onDraft);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('draft-changed', onDraft);
      window.removeEventListener('storage', refresh);
    };
  }, [key, owner]);
  return state.drafts;
}
