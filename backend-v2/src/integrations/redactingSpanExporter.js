'use strict';
const { redact } = require('../utils/redact');

// Last boundary before serialization: includes spans produced by auto-instrumentation,
// attributes set after startSpan, exceptions, links and status messages.
class RedactingSpanExporter {
  constructor(exporter) { this.exporter = exporter; }
  export(spans, callback) {
    const clean = spans.map(span => {
      const copy = Object.create(span);
      for (const field of ['name', 'attributes', 'events', 'links', 'status', 'instrumentationScope']) {
        Object.defineProperty(copy, field, { value: redact(span[field]), enumerable: true });
      }
      if (span.resource) {
        const resource = Object.create(span.resource);
        Object.defineProperty(resource, 'attributes', { value: redact(span.resource.attributes), enumerable: true });
        Object.defineProperty(copy, 'resource', { value: resource, enumerable: true });
      }
      return copy;
    });
    this.exporter.export(clean, callback);
  }
  shutdown() { return this.exporter.shutdown(); }
  forceFlush() { return this.exporter.forceFlush?.() ?? Promise.resolve(); }
}
module.exports = { RedactingSpanExporter };
