// Identity changes invalidate old work even after A -> B -> A. Credential
// rotation invalidates in-flight work while new actions can capture a new revision.
let generation = 0;
let active = null;
export const SESSION_OWNER_KEY = 'touliao_active_owner_v2';
export const SESSION_REVISION_KEY = 'touliao_session_revision';
const ownerKey = scope => JSON.stringify([scope.server, scope.accountId]);

export function activateSession(server, accountId) {
  active = Object.freeze({ server: server.replace(/\/$/, ''), accountId, generation: ++generation });
  localStorage.setItem(SESSION_OWNER_KEY, ownerKey(active));
  return active;
}
export function invalidateSession() { generation++; active = null; }
export function captureSession() {
  // Bootstrap/switch requests also belong to an operation, even without an owner.
  return { ...active, generation, revision: localStorage.getItem(SESSION_REVISION_KEY),
    ownerMarker: active ? ownerKey(active) : localStorage.getItem(SESSION_OWNER_KEY) };
}
export function isOperationGenerationCurrent(scope) {
  return !!scope && scope.generation === generation &&
    scope.ownerMarker === localStorage.getItem(SESSION_OWNER_KEY);
}
export function isOperationCurrent(scope) {
  return isOperationGenerationCurrent(scope) && scope.revision === localStorage.getItem(SESSION_REVISION_KEY);
}
export function isSessionCurrent(scope) {
  return isOperationCurrent(scope) && !!active &&
    scope.server === active.server && scope.accountId === active.accountId;
}
