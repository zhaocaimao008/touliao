import { captureSession, isOperationGenerationCurrent } from './sessionContext';
let revision = 0;
export const socialRevision = () => revision;
export function publishSocialChange(owner, payload = {}) {
  if (!owner?.accountId || !isOperationGenerationCurrent(owner) || captureSession().accountId !== owner.accountId ||
      (payload.userId && payload.userId !== owner.accountId)) return false;
  revision++;
  window.dispatchEvent(new Event('touliao:social-state'));
  return true;
}
export const isSocialRead = config => /^(get|head)$/i.test(config.method || 'get') &&
  /^\/?api\/(users\/|moments(?:\/|$)|messages\/(?:conversations|my-groups|conversation\/[^/]+\/(?:info|members)))/.test(config.url || '');
export const socialReadCurrent = config => config?._socialRevision == null || config._socialRevision === revision;
