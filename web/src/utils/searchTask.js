// One search lifetime: debounce, abort, and ignore responses after replacement.
// The active guard also covers transports that finish after abort was requested.
export function startSearchTask({ key, query, load, onState, delay = 280 }) {
  const controller = new AbortController();
  let active = true;
  let timer;
  const q = query.trim();
  const publish = (status, data = [], error = null) => {
    if (active && !controller.signal.aborted) onState({ key, status, data, error });
  };
  if (!q) {
    publish('idle');
  } else {
    publish('loading');
    timer = setTimeout(async () => {
      try {
        const data = await load(q, controller.signal);
        publish('success', Array.isArray(data) ? data : []);
      } catch (error) {
        publish('error', [], error);
      }
    }, delay);
  }
  return () => {
    active = false;
    clearTimeout(timer);
    controller.abort();
  };
}
