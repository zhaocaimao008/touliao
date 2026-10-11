export function mediaLoadReducer(state, event) {
  if (event.type === 'source') return { source: event.source, attempt: 0, status: 'loading' };
  // A late load/error from the previous image or retry cannot change this view.
  if (event.source !== state.source || event.attempt !== state.attempt) return state;
  if (event.type === 'retry') return { ...state, attempt: state.attempt + 1, status: 'loading' };
  if (event.type === 'ready') return { ...state, status: 'ready' };
  if (event.type === 'error') return { ...state, status: 'error' };
  return state;
}
