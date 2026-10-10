import { describe, expect, it, vi } from 'vitest';
import { createSettingsSession } from './settingsSession';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const original = { messageNotify: false, detailPreview: false, vibrate: true, quietEnabled: false,
  quietStart: '23:00', quietEnd: '07:00', ringtone: 'classic', requireVerify: true };

describe('settings load and confirmed saves', () => {
  it('keeps a failed load distinct from defaults and allows retry', async () => {
    const onState = vi.fn(), save = vi.fn();
    const session = createSettingsSession({ load: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(original), save, onState });
    await session.reload();
    expect(onState.mock.lastCall[0]).toMatchObject({ status: 'error', settings: null });
    expect(await session.update('requireVerify', false)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    await session.reload();
    expect(onState.mock.lastCall[0]).toMatchObject({ status: 'ready', settings: original });
  });

  it.each([
    ['messageNotify', true], ['detailPreview', true], ['vibrate', false],
    ['quietEnabled', true], ['quietStart', '22:00'], ['quietEnd', '08:00'],
    ['ringtone', 'soft'], ['requireVerify', false],
  ])('restores %s on failure without updating local confirmed preferences', async (key, value) => {
    const onState = vi.fn(), onConfirmed = vi.fn();
    const pending = deferred();
    const session = createSettingsSession({ load: async () => original, save: () => pending.promise, onState, onConfirmed });
    await session.reload();
    const result = session.update(key, value);
    expect(onState.mock.lastCall[0]).toMatchObject({ saving: true, settings: { [key]: value } });
    pending.reject(new Error('offline'));
    expect(await result).toBe(false);
    expect(onState.mock.lastCall[0]).toMatchObject({ saving: false, saveError: true, settings: original });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('prevents overlapping saves and commits the canonical server response', async () => {
    const pending = deferred(), save = vi.fn(() => pending.promise), onState = vi.fn(), onConfirmed = vi.fn();
    const session = createSettingsSession({ load: async () => original, save, onState, onConfirmed });
    await session.reload();
    const first = session.update('quietStart', '22:00', { timezone: 'Asia/Shanghai' });
    expect(await session.update('quietEnd', '09:00')).toBe(false);
    expect(await session.reload()).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({ quietStart: '22:00', timezone: 'Asia/Shanghai' });
    pending.resolve({ ...original, quietStart: '22:00' });
    expect(await first).toBe(true);
    expect(onState.mock.lastCall[0]).toMatchObject({ saving: false, saveError: false, settings: { quietStart: '22:00', quietEnd: '07:00' } });
    expect(onConfirmed).toHaveBeenLastCalledWith({ ...original, quietStart: '22:00' });
  });

  it('does not accept an old reload or publish after disposal', async () => {
    const old = deferred(), current = deferred(), save = deferred(), onState = vi.fn(), onConfirmed = vi.fn();
    let saveSignal;
    const session = createSettingsSession({ load: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise), save: (_body, signal) => { saveSignal = signal; return save.promise; }, onState, onConfirmed });
    const first = session.reload(), second = session.reload();
    current.resolve(original);
    await second;
    old.resolve({ ringtone: 'wrong' });
    await first;
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    const updating = session.update('ringtone', 'soft');
    session.dispose();
    expect(saveSignal.aborted).toBe(false);
    const calls = onState.mock.calls.length;
    save.resolve({ ...original, ringtone: 'soft' });
    await updating;
    expect(onState).toHaveBeenCalledTimes(calls);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending read when the page closes', async () => {
    const pending = deferred(), onState = vi.fn(), onConfirmed = vi.fn();
    let signal;
    const session = createSettingsSession({ load: value => { signal = value; return pending.promise; }, save: vi.fn(), onState, onConfirmed });
    const loading = session.reload();
    session.dispose();
    expect(signal.aborted).toBe(true);
    pending.resolve(original);
    await loading;
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onState).toHaveBeenCalledTimes(1);
  });
});
