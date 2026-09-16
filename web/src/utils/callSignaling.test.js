import { describe, it, expect } from 'vitest';
import { matchesCall, matchesCallEnd, matchesGroupStartAttempt, withCallId } from './callSignaling';

describe('matchesCall', () => {
  it('rejects an event from the same peer with an old callId', () => {
    expect(matchesCall({ from: 'bob', callId: 'old' }, { remoteId: 'bob', callId: 'new' })).toBe(false);
  });

  it('accepts an event from the same peer with the matching callId', () => {
    expect(matchesCall({ from: 'bob', callId: 'c1' }, { remoteId: 'bob', callId: 'c1' })).toBe(true);
  });

  it('rejects an event from a different peer even with a matching callId', () => {
    expect(matchesCall({ from: 'mallory', callId: 'c1' }, { remoteId: 'bob', callId: 'c1' })).toBe(false);
  });

  it('accepts when neither side has a callId yet (legacy compatibility)', () => {
    expect(matchesCall({ from: 'bob' }, { remoteId: 'bob' })).toBe(true);
  });

  it('accepts when only one side has a callId (nothing to contradict)', () => {
    expect(matchesCall({ from: 'bob' }, { remoteId: 'bob', callId: 'c1' })).toBe(true);
    expect(matchesCall({ from: 'bob', callId: 'c1' }, { remoteId: 'bob' })).toBe(true);
  });

  it('rejects a missing event or activeCall', () => {
    expect(matchesCall(null, { remoteId: 'bob', callId: 'c1' })).toBe(false);
    expect(matchesCall({ from: 'bob', callId: 'c1' }, null)).toBe(false);
  });
});

describe('withCallId', () => {
  it('adds callId to post-request payloads', () => {
    expect(withCallId({ to: 'bob' }, 'c1')).toEqual({ to: 'bob', callId: 'c1' });
  });

  it('leaves the payload untouched when callId is empty', () => {
    expect(withCallId({ to: 'bob' }, '')).toEqual({ to: 'bob' });
    expect(withCallId({ to: 'bob' }, undefined)).toEqual({ to: 'bob' });
  });

  it('does not mutate the original payload object', () => {
    const original = { to: 'bob' };
    const result = withCallId(original, 'c1');
    expect(original).toEqual({ to: 'bob' });
    expect(result).not.toBe(original);
  });
});

describe('matchesCallEnd', () => {
  const active = { remoteId: 'bob', callId: 'current-call' };

  it('accepts a server restart terminal without from only for the exact active callId', () => {
    expect(matchesCallEnd({ reason: 'server_restarted', callId: 'current-call' }, active)).toBe(true);
    expect(matchesCallEnd({ reason: 'server_restarted', callId: 'old-call' }, active)).toBe(false);
    expect(matchesCallEnd({ reason: 'server_restarted' }, active)).toBe(false);
  });

  it('does not treat another from-less terminal as belonging to the active call', () => {
    expect(matchesCallEnd({ reason: 'timeout', callId: 'current-call' }, active)).toBe(false);
  });

  it('preserves peer and callId matching for ordinary terminals', () => {
    expect(matchesCallEnd({ from: 'bob', reason: 'hangup', callId: 'current-call' }, active)).toBe(true);
    expect(matchesCallEnd({ from: 'bob', reason: 'hangup', callId: 'old-call' }, active)).toBe(false);
    expect(matchesCallEnd({ from: 'mallory', reason: 'hangup', callId: 'current-call' }, active)).toBe(false);
  });
});

describe('matchesGroupStartAttempt', () => {
  it('accepts matching and duplicate acknowledgements for the current attempt', () => {
    expect(matchesGroupStartAttempt({ requestId: 'attempt-current' }, 'attempt-current')).toBe(true);
    expect(matchesGroupStartAttempt({ requestId: 'attempt-current' }, 'attempt-current')).toBe(true);
  });

  it('rejects a late acknowledgement from an old or uncorrelated server request', () => {
    expect(matchesGroupStartAttempt({ requestId: 'attempt-old' }, 'attempt-current')).toBe(false);
    expect(matchesGroupStartAttempt({}, 'attempt-current')).toBe(false);
  });
});
