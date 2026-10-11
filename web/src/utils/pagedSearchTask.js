// One query owns all its pages. Keep successful results on a later-page error,
// cancel replaced queries and ignore late responses even if abort is ignored.
export function startPagedSearchTask({ key, query, load, onState, delay = 280, pageSize = 20, maxOffset = 10000 }) {
  let active = true, request = null, timer;
  let state = { key, status: query.trim() ? 'loading' : 'idle', data: [], total: null,
    offset: 0, hasMore: false, loadingMore: false, moreError: false, limited: false };
  const publish = patch => { state = { ...state, ...patch }; if (active) onState(state); };
  const fetchPage = async (offset) => {
    if (!active || request) return;
    const controller = new AbortController(); request = controller;
    publish(offset ? { loadingMore: true, moreError: false } : { status: 'loading', moreError: false });
    try {
      const response = await load(query.trim(), controller.signal, offset, pageSize);
      if (!active || request !== controller || controller.signal.aborted) return;
      const rows = Array.isArray(response) ? response : response?.results;
      if (!Array.isArray(rows)) throw new Error('Invalid search response');
      const total = Number.isFinite(response?.total) ? Math.max(0,response.total) : null;
      const merged = new Map((offset ? state.data : []).map(row => [row.id,row]));
      const previousSize = merged.size;
      rows.forEach(row => merged.set(row.id,row));
      const nextOffset = offset + rows.length;
      const more = rows.length > 0 && (total == null ? rows.length >= pageSize : nextOffset < total);
      const limited = more && nextOffset >= maxOffset;
      publish({ status: 'success', data: [...merged.values()], total, offset: nextOffset,
        hasMore: more && !limited && (!offset || merged.size > previousSize), limited, loadingMore: false, moreError: false });
    } catch {
      if (active && request === controller && !controller.signal.aborted)
        publish(offset ? { loadingMore: false, moreError: true } : { status: 'error', data: [], hasMore: false });
    } finally { if (request === controller) request = null; }
  };
  publish({});
  if (query.trim()) timer = setTimeout(() => fetchPage(0), delay);
  return {
    key,
    loadMore: () => { if (state.status === 'success' && state.hasMore) return fetchPage(state.offset); },
    cancel: () => { active = false; clearTimeout(timer); request?.abort(); request = null; },
  };
}
