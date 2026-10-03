import { afterEach, expect, test, vi } from 'vitest';
import { createCallResumeGate } from './callResumeGate';

afterEach(() => vi.useRealTimers());

test('a rejected resume never releases signaling, including after its fallback deadline', () => {
  vi.useFakeTimers();
  const onReady = vi.fn();
  const onRejected = vi.fn();
  const gate = createCallResumeGate({ onReady, onRejected });
  gate.begin()({ ok: false });
  vi.advanceTimersByTime(2000);
  expect(onReady).not.toHaveBeenCalled();
  expect(onRejected).toHaveBeenCalledOnce();
});

test('a stale ack or fallback cannot release signaling after another reconnect', () => {
  vi.useFakeTimers();
  const onReady = vi.fn();
  const onRejected = vi.fn();
  const gate = createCallResumeGate({ onReady, onRejected });
  const oldAck = gate.begin();
  gate.stop();
  const newAck = gate.begin();
  oldAck({ ok: true });
  oldAck({ ok: false });
  expect(onReady).not.toHaveBeenCalled();
  expect(onRejected).not.toHaveBeenCalled();
  newAck({ ok: true });
  vi.advanceTimersByTime(2000);
  expect(onReady).toHaveBeenCalledOnce();
});

test('no ack uses the legacy fallback once; a later rejection still closes the call', () => {
  vi.useFakeTimers();
  const onReady = vi.fn();
  const onRejected = vi.fn();
  const gate = createCallResumeGate({ onReady, onRejected });
  const ack = gate.begin();
  vi.advanceTimersByTime(1500);
  expect(onReady).toHaveBeenCalledOnce();
  ack({ ok: false });
  expect(onRejected).toHaveBeenCalledOnce();
  ack({ ok: false });
  expect(onRejected).toHaveBeenCalledOnce();
});
