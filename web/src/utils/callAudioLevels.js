// Local analysis only: microphone/remote samples are never recorded or uploaded.
export function createCallAudioLevels(context, onUpdate, { threshold = 0.02, holdMs = 350 } = {}) {
  const entries = new Map();
  const last = new Map();
  let disposed = false;
  const remove = id => {
    const entry = entries.get(id);
    if (entry) { entry.source.disconnect(); entry.analyser.disconnect(); entries.delete(id); }
  };
  return {
    sync(streams) {
      for (const id of entries.keys()) if (!streams[id] || streams[id] !== entries.get(id).stream) remove(id);
      for (const [id, stream] of Object.entries(streams)) {
        if (!stream || entries.has(id) || !stream.getAudioTracks().length) continue;
        try {
          const source = context.createMediaStreamSource(stream);
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser); // Do not connect to destination: avoids echo/double playback.
          entries.set(id, { stream, source, analyser, samples: new Uint8Array(analyser.fftSize), lastVoice: -Infinity });
        } catch { /* Streams ending during a participant leave are harmless. */ }
      }
    },
    sample(now) {
      if (disposed) return;
      const next = {};
      for (const [id, entry] of entries) {
        let level = 0;
        const enabled = context.state === 'running' && entry.stream.getAudioTracks().some(t => t.readyState === 'live' && t.enabled && !t.muted);
        if (enabled) {
          entry.analyser.getByteTimeDomainData(entry.samples);
          level = Math.sqrt(entry.samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / entry.samples.length);
          if (level >= threshold) entry.lastVoice = now;
        } else entry.lastVoice = -Infinity;
        next[id] = { speaking: enabled && now - entry.lastVoice < holdMs, level: Math.min(1, Math.round(level * 400) / 100) };
      }
      const changed = last.size !== Object.keys(next).length || Object.entries(next).some(([id,v]) => last.get(id)?.speaking !== v.speaking || last.get(id)?.level !== v.level);
      if (changed) { last.clear(); Object.entries(next).forEach(([id,v]) => last.set(id,v)); onUpdate(next); }
    },
    dispose() { disposed = true; for (const id of [...entries.keys()]) remove(id); },
  };
}
