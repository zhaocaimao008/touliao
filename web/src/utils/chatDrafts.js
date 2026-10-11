import { clientStorage } from './clientStorage';

const PREFIX = 'draft_v2_';
const fallback = new Map();
export const draftOwnerKey = scope => scope?.server && scope?.accountId
  ? JSON.stringify([scope.server, scope.accountId]) : '';
const keyFor = (conversationId, scope) => draftOwnerKey(scope) && conversationId
  ? PREFIX + JSON.stringify([scope.server, scope.accountId, conversationId]) : '';
export const draftNeedsStorage = (conversationId, scope) => fallback.has(keyFor(conversationId, scope));

export function loadDraft(conversationId, scope) {
  const key = keyFor(conversationId, scope);
  if (!key) return '';
  if (fallback.has(key)) return fallback.get(key);
  try { return clientStorage.getItem(key) || ''; } catch { return ''; }
}

/** Unowned legacy draft_<id> keys are retained, never assigned to a guessed account. */
export function listDrafts(scope) {
  const result = {};
  if (!draftOwnerKey(scope)) return result;
  const keys = new Set(fallback.keys());
  try { for (let i = 0; i < clientStorage.length; i++) keys.add(clientStorage.key(i)); } catch { /* Use this page's fallback. */ }
  for (const key of keys) {
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const [server, accountId, conversationId] = JSON.parse(key.slice(PREFIX.length));
      if (server !== scope.server || accountId !== scope.accountId || typeof conversationId !== 'string') continue;
      const text = loadDraft(conversationId, scope);
      if (text) result[conversationId] = text;
    } catch { /* A corrupt key must not break the conversation list. */ }
  }
  return result;
}

export function saveDraft(conversationId, text, scope) {
  const key = keyFor(conversationId, scope);
  if (!key || typeof text !== 'string') return false;
  let persisted = true;
  try {
    if (text) clientStorage.setItem(key, text);
    else clientStorage.removeItem(key);
    fallback.delete(key);
  } catch {
    // Include empty tombstones so an old disk draft cannot return after a failed clear.
    fallback.set(key, text);
    persisted = false;
  }
  window.dispatchEvent(new CustomEvent('draft-changed', { detail: {
    convId: conversationId, text, owner: draftOwnerKey(scope),
  } }));
  return persisted;
}
