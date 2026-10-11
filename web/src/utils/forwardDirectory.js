// A failed or malformed directory response must not look like an empty list.
// Disposal also guards clients/adapters that resolve after an abort.
export function loadForwardDirectory(request, publish) {
  const controller = new AbortController();
  let active = true;
  publish({ status: 'loading', items: [] });
  Promise.resolve().then(() => request(controller.signal)).then(items => {
    if (!Array.isArray(items)) throw new Error('Invalid forwarding directory');
    if (active) publish({ status: 'ready', items });
  }).catch(() => {
    if (active) publish({ status: 'error', items: [] });
  });
  return () => { active = false; controller.abort(); };
}
