import { useSyncExternalStore } from 'react';
import { socialRevision } from '../utils/socialState';
const subscribe = listener => {
  window.addEventListener('touliao:social-state', listener);
  return () => window.removeEventListener('touliao:social-state', listener);
};
// Socket invalidations and reconnects use the same authoritative GET effects.
export function useSocialRevision() { return useSyncExternalStore(subscribe, socialRevision, socialRevision); }
