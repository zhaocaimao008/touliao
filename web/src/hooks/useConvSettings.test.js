import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { useConvSettings } from './useConvSettings';
const hooks = vi.hoisted(() => ({ states: [], effects: [] }));
vi.mock('../hooks/useSocialRevision', () => ({ useSocialRevision: () => 0 }));
vi.mock('../utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('react', () => ({
  useRef: value => ({ current: value }),
  useEffect: effect => hooks.effects.push(effect),
  useState: value => {
    const index = hooks.states.length; hooks.states.push(value);
    return [value, next => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }];
  },
}));
beforeEach(() => { hooks.states = []; hooks.effects = []; });
afterEach(() => vi.restoreAllMocks());
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
test.each(['Mute', 'Pin'])('late %s acknowledgement does not overwrite newer authoritative preference', async kind => {
  let resolve;
  vi.spyOn(axios, 'post').mockReturnValue(new Promise(done => { resolve = done; }));
  vi.spyOn(axios, 'get').mockResolvedValue({ data: [{ id: 'C', muted: 0, pinned: 0 }] });
  const changed = vi.fn();
  const api = useConvSettings({ id: 'C', muted: 0, pinned: 0 }, changed);
  hooks.effects[0](); await flush();
  const saving = api['toggle' + kind](true);
  // Another device has already reverted the value while this POST response is delayed.
  resolve({ data: { success: true } }); await saving;
  expect(hooks.states[kind === 'Mute' ? 0 : 1]).toBe(false);
  expect(changed.mock.calls.some(([value]) => value.muted === 1 || value.pinned === 1)).toBe(false);
});
