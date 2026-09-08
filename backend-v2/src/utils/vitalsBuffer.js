'use strict';
// Anonymous, sampled, bounded instance diagnostics. No URLs, UA, user ids or tenant identifiers are retained.
function createVitalsBuffer({ max = 500, retentionMs = 3600000, sampleRate = 0.1, random = Math.random, now = Date.now } = {}) {
  const rows = [];
  const names = new Set(['FCP','LCP','CLS','INP','TTFB']);
  const prune = () => { while (rows.length && rows[0].t <= now() - retentionMs) rows.shift(); };
  return {
    add(body) {
      prune();
      if (!body || !names.has(body.name) || !Number.isFinite(body.value) || body.value < 0) return false;
      if (random() >= sampleRate) return true;
      rows.push({ name: body.name, value: body.value, rating: ['good','needs-improvement','poor'].includes(body.rating) ? body.rating : null, t: now() });
      if (rows.length > max) rows.splice(0,rows.length-max);
      return true;
    },
    recent() { prune(); return rows.slice(-100); },
  };
}
module.exports = { createVitalsBuffer };
