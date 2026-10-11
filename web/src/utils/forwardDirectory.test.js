import { describe, expect, it, vi } from 'vitest';
import { loadForwardDirectory } from './forwardDirectory';

const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
describe('forwarding directory lifecycle', () => {
  it('distinguishes a successfully loaded empty directory from loading', async () => {
    const publish = vi.fn();
    loadForwardDirectory(async () => [], publish);
    expect(publish).toHaveBeenLastCalledWith({ status: 'loading', items: [] });
    await settle();
    expect(publish).toHaveBeenLastCalledWith({ status: 'ready', items: [] });
  });
  it('shows a recoverable error for a rejected request and allows a fresh attempt', async () => {
    const publish = vi.fn();
    const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{ id: 'friend' }]);
    const dispose = loadForwardDirectory(request, publish);
    await settle();
    expect(publish).toHaveBeenLastCalledWith({ status: 'error', items: [] });
    dispose();
    loadForwardDirectory(request, publish);
    await settle();
    expect(publish).toHaveBeenLastCalledWith({ status: 'ready', items: [{ id: 'friend' }] });
  });
  it('treats malformed responses as errors instead of an empty list', async () => {
    const publish = vi.fn();
    loadForwardDirectory(async () => ({ error: 'unavailable' }), publish);
    await settle();
    expect(publish).toHaveBeenLastCalledWith({ status: 'error', items: [] });
  });
  it('aborts and ignores a response after the dialog has closed', async () => {
    const publish = vi.fn();
    let resolve, signal;
    const dispose = loadForwardDirectory(s => { signal = s; return new Promise(r => { resolve = r; }); }, publish);
    await settle();
    dispose();
    expect(signal.aborted).toBe(true);
    resolve([{ id: 'late' }]);
    await settle();
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
