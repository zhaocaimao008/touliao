import { captureSession } from './sessionContext';

function newKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // getRandomValues is also available in older WebViews and insecure contexts.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Keep a key for the same user intent while a modal stays open, including manual
// retries after a timeout. A changed payload/account is a different operation.
export function createFinancialRequest() {
  const keys = new Map();
  return payload => {
    const scope = captureSession();
    const fingerprint = JSON.stringify([scope.server, scope.accountId, scope.ownerMarker, payload]);
    if (!keys.has(fingerprint)) keys.set(fingerprint, newKey());
    return { skipRetry: true, _sessionContext: scope, headers: { 'Idempotency-Key': keys.get(fingerprint) } };
  };
}
