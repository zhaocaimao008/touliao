import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
const source = readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8');
function worker(windows = []) {
  const handlers = {};
  const registration = { scope: 'https://app.test/push/A/session-A/default/', showNotification: vi.fn().mockResolvedValue() };
  const clients = { matchAll: async () => windows, openWindow: vi.fn().mockResolvedValue() };
  class Channel {
    constructor() {
      this.port1 = { close() {}, onmessage: null };
      this.port2 = { close() {}, postMessage: data => queueMicrotask(() => this.port1.onmessage({ data })) };
    }
  }
  vm.runInNewContext(source, { self: { registration, location: { origin: 'https://app.test' }, addEventListener: (type, fn) => { handlers[type] = fn; } },
    clients, URL, crypto: { randomUUID }, MessageChannel: Channel, setTimeout, clearTimeout });
  const dispatch = async (type, data = {}) => {
    let pending;
    handlers[type]({ ...data, waitUntil: promise => { pending = promise; } });
    await pending;
  };
  return { dispatch, registration, clients };
}
test('push validates recipient and namespaces the notification tag', async () => {
  const w = worker();
  await w.dispatch('push', { data: { json: () => ({ recipientId: 'B', body: 'private' }) } });
  expect(w.registration.showNotification).not.toHaveBeenCalled();
  await w.dispatch('push', { data: { json: () => ({ recipientId: 'A', body: 'hello', conversationId: 'C' }) } });
  expect(w.registration.showNotification.mock.calls[0][1]).toMatchObject({ tag: 'touliao-A-C', data: { recipientId: 'A', sessionId: 'session-A', windowId: 'default' } });
});
test('notification click skips an unrelated first window and waits for a matching account', async () => {
  const windows = [false, true].map(accepted => ({ url: 'https://app.test/', focus: vi.fn(), postMessage: (_data, ports) => ports[0].postMessage(accepted) }));
  const w = worker(windows);
  await w.dispatch('notificationclick', { notification: { close() {}, data: { recipientId: 'A', sessionId: 'session-A', conversationId: 'C' } } });
  expect(windows[0].focus).not.toHaveBeenCalled();
  expect(windows[1].focus).toHaveBeenCalledOnce();
  expect(w.clients.openWindow).not.toHaveBeenCalled();
});
test('closed account notifications reopen an isolated same-origin login path, never a supplied URL', async () => {
  const w = worker();
  await w.dispatch('notificationclick', { notification: { close() {}, data: { recipientId: 'A', conversationId: 'C', url: 'https://evil.test' } } });
  const target = new URL(w.clients.openWindow.mock.calls[0][0]);
  expect(target.origin).toBe('https://app.test');
  expect(target.searchParams.get('accountWindow')).toMatch(/^[a-f0-9-]{36}$/);
  expect(target.searchParams.get('pushAccount')).toBe('A');
});
test('subscription changes ask the correct live account to renew without using a shared Cookie', async () => {
  const client = { postMessage: vi.fn() }, w = worker([client]);
  await w.dispatch('pushsubscriptionchange');
  expect(client.postMessage).toHaveBeenCalledWith({ type: 'PUSH_RESUBSCRIBE', recipientId: 'A', sessionId: 'session-A', windowId: 'default' });
});
