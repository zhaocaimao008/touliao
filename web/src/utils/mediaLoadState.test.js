import { describe, expect, it } from 'vitest';
import { mediaLoadReducer as reduce } from './mediaLoadState';

describe('media preview loading and recovery', () => {
  it('retries a failed source with a fresh element identity', () => {
    let state = { source: 'image-a', attempt: 0, status: 'loading' };
    state = reduce(state, { type: 'error', source: 'image-a', attempt: 0 });
    expect(state.status).toBe('error');
    state = reduce(state, { type: 'retry', source: 'image-a', attempt: 0 });
    expect(state).toEqual({ source: 'image-a', attempt: 1, status: 'loading' });
    state = reduce(state, { type: 'ready', source: 'image-a', attempt: 1 });
    expect(state.status).toBe('ready');
  });
  it('ignores events from an earlier retry and double activation of retry', () => {
    let state = { source: 'video-a', attempt: 0, status: 'error' };
    state = reduce(state, { type: 'retry', source: 'video-a', attempt: 0 });
    for (const type of ['error', 'ready', 'retry']) expect(reduce(state, { type, source: 'video-a', attempt: 0 })).toBe(state);
  });
  it('does not let the previous gallery image settle a new image', () => {
    const state = reduce({ source: 'old', attempt: 2, status: 'ready' }, { type: 'source', source: 'new' });
    expect(state).toEqual({ source: 'new', attempt: 0, status: 'loading' });
    expect(reduce(state, { type: 'error', source: 'old', attempt: 2 })).toBe(state);
    expect(reduce(state, { type: 'ready', source: 'old', attempt: 2 })).toBe(state);
  });
});
