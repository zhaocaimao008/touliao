import { clientStorage } from './clientStorage';
import { captureSession, isOperationGenerationCurrent } from './sessionContext';
const prefix = 'touliao_draft_v2:';
function current(owner) {
  const now = captureSession();
  return !!owner?.accountId && !!owner.server && isOperationGenerationCurrent(owner) &&
    owner.accountId === now.accountId && owner.server === now.server;
}
const key = (owner, conversationId) => prefix + JSON.stringify([owner.server, owner.accountId, conversationId]);
// Old draft_<conversation> keys have no provable owner; keep them quarantined,
// never import them into whichever account happens to log in first.
export function readDraft(conversationId, owner = captureSession()) {
  if (!conversationId || !current(owner)) return '';
  try { return clientStorage.getItem(key(owner, conversationId)) || ''; } catch { return ''; }
}
export function writeDraft(conversationId, text, owner) {
  if (!conversationId || !current(owner)) return false;
  try {
    if (text) clientStorage.setItem(key(owner, conversationId), text);
    else clientStorage.removeItem(key(owner, conversationId));
    return true;
  } catch { return false; }
}
export const clearDraft = (conversationId, owner) => writeDraft(conversationId, '', owner);
export function readAllDrafts(owner = captureSession()) {
  const drafts = {};
  if (!current(owner)) return drafts;
  try {
    for (let i = 0; i < clientStorage.length; i++) {
      const k = clientStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      let parts; try { parts = JSON.parse(k.slice(prefix.length)); } catch { continue; }
      if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== owner.server || parts[1] !== owner.accountId) continue;
      const text = clientStorage.getItem(k);
      if (text) drafts[parts[2]] = text;
    }
  } catch { /* Storage unavailable: no draft is exposed. */ }
  return drafts;
}
