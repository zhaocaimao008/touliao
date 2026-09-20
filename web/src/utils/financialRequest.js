import { captureSession } from './sessionContext';

// Keep a key for the same user intent while a modal stays open, including manual
// retries after a timeout. A changed payload/account is a different operation.
export function createFinancialRequest() {
  const keys = new Map();
  return payload => {
    const scope = captureSession();
    const fingerprint = JSON.stringify([scope.server, scope.accountId, scope.ownerMarker, payload]);
    if (!keys.has(fingerprint)) keys.set(fingerprint, crypto.randomUUID());
    return { skipRetry: true, _sessionContext: scope, headers: { 'Idempotency-Key': keys.get(fingerprint) } };
  };
}
