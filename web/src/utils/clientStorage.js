const WINDOW_KEY = 'touliao_account_window';

export function accountWindowId() {
  if (typeof sessionStorage === 'undefined') return '';
  return sessionStorage.getItem(WINDOW_KEY) || '';
}

export const isIsolatedWindow = () => !!accountWindowId();
export const isBearerClient = () => isIsolatedWindow() ||
  !!(window.__ELECTRON_CONFIG__ || window.Capacitor?.isNativePlatform?.());

export function initAccountWindow() {
  if (window.__ELECTRON_CONFIG__ || window.Capacitor?.isNativePlatform?.()) return;
  const url = new URL(window.location.href);
  const requested = url.searchParams.get('accountWindow');
  if (requested && /^[a-f0-9-]{36}$/.test(requested) && requested !== accountWindowId()) {
    // A duplicated/opener tab may start with a copy of sessionStorage.
    sessionStorage.clear();
    sessionStorage.setItem(WINDOW_KEY, requested);
  }
}

function storage() {
  return isIsolatedWindow() ? sessionStorage : globalThis.localStorage;
}

export const clientStorage = {
  getItem: key => storage().getItem(key),
  setItem: (key, value) => storage().setItem(key, value),
  removeItem: key => storage().removeItem(key),
  key: index => storage().key(index),
  get length() { return storage().length; },
};

export function openAccountWindow() {
  if (window.electronAPI?.newAccountWindow) return window.electronAPI.newAccountWindow();
  const url = new URL('/login', window.location.origin);
  url.searchParams.set('accountWindow', crypto.randomUUID());
  window.open(url.href, '_blank', 'noopener,noreferrer');
}
