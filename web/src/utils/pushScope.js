import { accountWindowId } from './clientStorage';

// Each browser PushManager belongs to a registration, not to a browser tab.
export function pushScope(user) {
  return `/push/${encodeURIComponent(user.id)}/${encodeURIComponent(user.sessionId || 'legacy')}/${accountWindowId() || 'default'}/`;
}

export function matchesPushTarget(data, user) {
  return !!user && data?.recipientId === user.id &&
    (!data.sessionId || data.sessionId === (user.sessionId || 'legacy')) &&
    (!data.windowId || data.windowId === (accountWindowId() || 'default'));
}

export async function waitForPushWorker(registration) {
  if (registration.active) return;
  const worker = registration.installing || registration.waiting;
  if (!worker) throw new Error('Push worker is unavailable');
  await new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', check);
      if (error) reject(error); else resolve();
    };
    const check = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('Push worker installation failed'));
    };
    const timeout = setTimeout(() => finish(new Error('Push worker activation timed out')), 10000);
    worker.addEventListener('statechange', check);
    check();
  });
}
