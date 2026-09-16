import { describe, expect, it } from 'vitest';
import * as callLifecycle from './callLifecycle';

const { initializeCallMedia } = callLifecycle;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function streamWithTracks(kinds = ['audio', 'video']) {
  const tracks = kinds.map(kind => ({ kind, stopped: false, stop() { this.stopped = true; } }));
  return { tracks, getTracks: () => tracks };
}

function peerConnection() {
  return {
    closed: false,
    senders: [],
    addTrack(track, stream) { this.senders.push({ track, stream }); },
    close() { this.closed = true; },
  };
}

function setup(overrides = {}) {
  let current = true;
  const published = { stream: null, pc: null, mediaError: null };
  let iceRequests = 0;
  let pcCreations = 0;
  const options = {
    constraints: { audio: true, video: true },
    getUserMedia: async () => streamWithTracks(),
    createEmptyStream: () => streamWithTracks([]),
    fetchIceConfig: async () => { iceRequests += 1; return { iceServers: [] }; },
    createPeerConnection: () => { pcCreations += 1; return peerConnection(); },
    preparePeerConnection: async () => {},
    isCurrent: () => current,
    publishStream: stream => { published.stream = stream; },
    publishPeerConnection: pc => { published.pc = pc; },
    discardStream: stream => { if (published.stream === stream) published.stream = null; },
    discardPeerConnection: pc => { if (published.pc === pc) published.pc = null; },
    setMediaError: value => { published.mediaError = value; },
    ...overrides,
  };
  return {
    options,
    published,
    cancel: () => { current = false; },
    iceRequests: () => iceRequests,
    pcCreations: () => pcCreations,
  };
}

describe('initializeCallMedia', () => {
  it('stops media that resolves after the call generation is cancelled', async () => {
    const media = deferred();
    const stream = streamWithTracks();
    const harness = setup({ getUserMedia: () => media.promise });
    const initializing = initializeCallMedia(harness.options);

    harness.cancel();
    media.resolve(stream);

    expect(await initializing).toBeNull();
    expect(stream.tracks.every(track => track.stopped)).toBe(true);
    expect(harness.iceRequests()).toBe(0);
    expect(harness.pcCreations()).toBe(0);
    expect(harness.published.stream).toBeNull();
    expect(harness.published.mediaError).toBeNull();
  });

  it('does not create a peer connection when TURN returns after cancellation', async () => {
    const ice = deferred();
    const stream = streamWithTracks();
    const harness = setup({ getUserMedia: async () => stream, fetchIceConfig: () => ice.promise });
    const initializing = initializeCallMedia(harness.options);
    await Promise.resolve();

    harness.cancel();
    ice.resolve({ iceServers: [] });

    expect(await initializing).toBeNull();
    expect(stream.tracks.every(track => track.stopped)).toBe(true);
    expect(harness.pcCreations()).toBe(0);
    expect(harness.published.stream).toBeNull();
  });

  it('keeps the empty-stream fallback when active media permission is denied', async () => {
    const emptyStream = streamWithTracks([]);
    const harness = setup({
      getUserMedia: async () => { throw new Error('permission denied'); },
      createEmptyStream: () => emptyStream,
    });

    const pc = await initializeCallMedia(harness.options);

    expect(pc).toBe(harness.published.pc);
    expect(harness.published.stream).toBe(emptyStream);
    expect(harness.published.mediaError).toBe(true);
    expect(harness.pcCreations()).toBe(1);
  });

  it('closes a peer connection when cancellation occurs during codec preparation', async () => {
    const preparing = deferred();
    const stream = streamWithTracks();
    const pc = peerConnection();
    const harness = setup({
      getUserMedia: async () => stream,
      createPeerConnection: () => pc,
      preparePeerConnection: () => preparing.promise,
    });
    const initializing = initializeCallMedia(harness.options);
    await Promise.resolve();
    await Promise.resolve();

    harness.cancel();
    preparing.resolve();

    expect(await initializing).toBeNull();
    expect(pc.closed).toBe(true);
    expect(stream.tracks.every(track => track.stopped)).toBe(true);
    expect(harness.published.stream).toBeNull();
    expect(harness.published.pc).toBeNull();
  });
});

describe('call media handoff guards', () => {
  it('rejects a PC invalidated between an awaited helper and its caller continuation', () => {
    const pc = peerConnection();

    expect(callLifecycle.currentCallMedia(pc, () => false)).toBeNull();
  });

  it('does not install an outgoing timeout after initPC resolves into an old generation', () => {
    let installed = false;

    const timer = callLifecycle.scheduleCurrentCallTimeout({
      pc: peerConnection(),
      isCurrent: () => false,
      setTimer: () => { installed = true; return 1; },
      delay: 30_000,
      onTimeout: () => {},
    });

    expect(timer).toBeNull();
    expect(installed).toBe(false);
  });

  it('suppresses an installed timeout when its call generation later becomes stale', () => {
    let current = true;
    let scheduled;
    let expired = false;
    const pc = peerConnection();

    const timer = callLifecycle.scheduleCurrentCallTimeout({
      pc,
      isCurrent: value => current && value === pc,
      setTimer: callback => { scheduled = callback; return 7; },
      delay: 30_000,
      onTimeout: () => { expired = true; },
    });
    current = false;
    scheduled();

    expect(timer).toBe(7);
    expect(expired).toBe(false);
  });

  it('installs and executes the outgoing timeout for the current PC', () => {
    let scheduled;
    let expired = false;
    const pc = peerConnection();

    const timer = callLifecycle.scheduleCurrentCallTimeout({
      pc,
      isCurrent: value => value === pc,
      setTimer: (callback, delay) => { scheduled = { callback, delay }; return 9; },
      delay: 30_000,
      onTimeout: () => { expired = true; },
    });
    scheduled.callback();

    expect(timer).toBe(9);
    expect(scheduled.delay).toBe(30_000);
    expect(expired).toBe(true);
  });
});
