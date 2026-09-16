import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { activateSession, captureSession } from './sessionContext';
import { sendOwnedText } from './outboxSender';
import { loadOutbox, upsertOutbox } from './outbox';

const message = { id: 'm1', _tempId: 'm1', sender_id: 'A', conversation_id: 'same-group', content: 'A text', type: 'text' };
beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map();
  vi.stubGlobal('localStorage', { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) });
  activateSession('https://one.test', 'A');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('offline composer persists failure without enqueueing a Socket buffer', () => {
  let status;
  const wire = [];
  const scope = captureSession();
  sendOwnedText({ scope, message, socket: { connected: false, emit: (...args) => wire.push(args) }, onStatus: s => { status = s; } });
  expect(status).toBe('error');
  expect(wire).toEqual([]);
  expect(loadOutbox('same-group', scope)[0].content).toBe('A text');
});

test.each(['account', 'server', 'aba', 'credentials'])('late ACK and timeout after %s switch cannot change storage or UI', mode => {
  const scope = captureSession();
  upsertOutbox('same-group', message, scope);
  let ack;
  const events = [];
  sendOwnedText({ scope, message, socket: { connected: true, emit: (_event, _body, callback) => { ack = callback; } }, onStatus: s => events.push(s), onAck: m => events.push(m) });
  expect(loadOutbox('same-group', scope)).toHaveLength(1);
  if (mode === 'credentials') localStorage.setItem('touliao_session_revision', 'new');
  else activateSession(mode === 'server' ? 'https://two.test' : 'https://one.test', mode === 'server' ? 'A' : 'B');
  if (mode === 'aba') activateSession('https://one.test', 'A');
  ack({ success: true, message: { ...message, id: 'confirmed' } });
  vi.runAllTimers();
  expect(events).toEqual(['sending']);
  expect(loadOutbox('same-group', scope)).toHaveLength(1);
  const wire = [];
  sendOwnedText({ scope, message, socket: { connected: true, emit: (...args) => wire.push(args) }, onStatus: s => events.push(s) });
  expect(wire).toEqual([]);
});

test('new action after same-account credential rotation can ACK original failure', () => {
  const original = captureSession();
  upsertOutbox('same-group', message, original);
  localStorage.setItem('touliao_session_revision', 'fresh');
  let accepted;
  sendOwnedText({ scope: captureSession(), message,
    socket: { connected: true, emit: (_event, _body, ack) => ack({ success: true, message: { ...message, id: 'real' } }) },
    onStatus: () => {}, onAck: msg => { accepted = msg.id; } });
  expect(accepted).toBe('real');
  expect(loadOutbox('same-group', original)).toEqual([]);
});
