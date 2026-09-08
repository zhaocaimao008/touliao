// One factory per user action/modal: retries reuse a key; a new action can send identical content intentionally.
export function createMessageKeys(generate = () => globalThis.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  const keys = new Map();
  return (target, content) => {
    const existing = keys.get(target);
    if (existing?.content === content) return existing.key;
    const key = generate(); keys.set(target, { content, key }); return key;
  };
}
