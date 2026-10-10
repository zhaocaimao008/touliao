import { isSessionCurrent } from './sessionContext';

const EVENT = 'touliao:conversation-settings';
export function publishConversationSettings(conversationId, patch, scope) {
  if (isSessionCurrent(scope)) window.dispatchEvent(new CustomEvent(EVENT, { detail: { conversationId, patch, scope } }));
}
export function subscribeConversationSettings(onChange) {
  const handler = ({ detail }) => {
    if (!detail?.conversationId || !isSessionCurrent(detail.scope)) return;
    const patch = {};
    for (const key of ['muted', 'pinned', 'burn_after']) {
      if (Object.hasOwn(detail.patch || {}, key)) patch[key] = detail.patch[key];
    }
    if (Object.keys(patch).length) onChange({ conversationId: detail.conversationId, patch });
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
export function applyConversationSettings(conversation, { conversationId, patch }) {
  return conversation?.id === conversationId ? { ...conversation, ...patch } : conversation;
}
