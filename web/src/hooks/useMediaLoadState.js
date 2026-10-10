import { useReducer } from 'react';
import { mediaLoadReducer } from '../utils/mediaLoadState';

export default function useMediaLoadState(source) {
  const [state, dispatch] = useReducer(mediaLoadReducer, { source, attempt: 0, status: 'loading' });
  if (state.source !== source) dispatch({ type: 'source', source });
  const attempt = state.source === source ? state.attempt : 0;
  return {
    status: state.source === source ? state.status : 'loading',
    key: JSON.stringify([source, attempt]),
    ready: () => dispatch({ type: 'ready', source, attempt }),
    fail: () => dispatch({ type: 'error', source, attempt }),
    retry: () => dispatch({ type: 'retry', source, attempt }),
  };
}
