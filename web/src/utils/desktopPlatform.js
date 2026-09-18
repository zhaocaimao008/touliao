// Supplied by Electron's preload, never inferred from a browser's user agent.
export function isWindowsDesktop() {
  return window.__ELECTRON_CONFIG__?.platform === 'win32';
}
