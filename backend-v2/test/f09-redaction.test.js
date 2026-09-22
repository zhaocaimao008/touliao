const { redact } = require('../src/utils/redact');
jest.mock('@sentry/node', () => ({ init: jest.fn() }));
test('nested Sentry events, breadcrumbs, errors and headers redact URL credentials', () => {
  const clean = redact({ request: { query_string: 'token=synthetic-secret', url: '/uploads/a?token=synthetic-secret&ok=1', headers: { Authorization: 'Bearer synthetic-secret' } },
    breadcrumbs: [{ data: { url: 'https://fixture.invalid/x?X-Amz-Signature=synthetic-secret' } }],
    exception: { values: [{ value: 'GET /x?token=synthetic-secret failed' }] }, token: 'synthetic-secret' });
  expect(JSON.stringify(clean)).not.toContain('synthetic-secret');
  expect(clean.request.url).toContain('&ok=1');
});
test('registered Sentry event, transaction and breadcrumb hooks sanitize outbound payloads', () => {
  const config = require('../src/config');
  const previous = config.sentry;
  config.sentry = { dsn: 'https://synthetic@example.invalid/1' };
  try {
    require('../src/utils/sentry').initSentry();
    const options = require('@sentry/node').init.mock.calls.at(-1)[0];
    const event = { request: { url: '/uploads/a?token=synthetic-secret', headers: { Authorization: 'Bearer synthetic-secret' } }, breadcrumbs: [{ message: 'token=synthetic-secret' }] };
    for (const hook of [options.beforeSend, options.beforeSendTransaction, options.beforeBreadcrumb]) {
      expect(JSON.stringify(hook(event, {}))).not.toContain('synthetic-secret');
    }
  } finally { config.sentry = previous; }
});

test('diagnostic codes survive while OTP, phone and encoded credential keys are removed', () => {
  const clean = redact({ error: { code: 'ECONNRESET' }, status: { code: 2 }, code: '123456', phone: 'synthetic-phone',
    url: '/uploads/a?%74oken=synthetic-secret&access_token=synthetic-secret&size=80',
    'http.request.header.authorization': ['synthetic-secret'] });
  expect(clean.error.code).toBe('ECONNRESET');
  expect(clean.status.code).toBe(2);
  expect(clean.url).toContain('size=80');
  expect(JSON.stringify(clean)).not.toMatch(/synthetic-secret|123456|synthetic-phone/);
});
test('real Winston transports persist sanitized records and preserve diagnostics', async () => {
  const fs = require('fs');
  const path = require('path');
  const { once } = require('events');
  const { logger } = require('../src/utils/logger');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'f09-winston-'));
  const transport = new (require('winston').transports.File)({ filename: path.join(dir, 'actual.log') });
  logger.add(transport);
  try {
    const logged = once(transport, 'logged');
    logger.error('download /uploads/a?token=synthetic-secret', { authorization: 'Bearer synthetic-secret', error: { code: 'ENOENT' } });
    await logged;
    const finished = once(transport, 'finish'); transport.end(); await finished;
    const record = fs.readFileSync(path.join(dir, 'actual.log'), 'utf8');
    expect(record).toContain('[REDACTED]'); expect(record).toContain('ENOENT');
    expect(record).not.toContain('synthetic-secret');
  } finally { logger.remove(transport); transport.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('actual OTEL spans sanitize late auto-instrumentation attributes and exceptions at export', async () => {
  const { BasicTracerProvider, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { RedactingSpanExporter } = require('../src/integrations/redactingSpanExporter');
  const exported = [];
  const sink = { export: (spans, callback) => { exported.push(...spans); callback({ code: 0 }); }, shutdown: async () => {} };
  const provider = new BasicTracerProvider({ resource: resourceFromAttributes({ 'deployment.url': '/x?token=synthetic-secret' }),
    spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(sink))] });
  try {
    const span = provider.getTracer('http-auto-fixture').startSpan('GET /uploads/file');
    span.setAttributes({ 'http.url': 'https://fixture.invalid/uploads/a?token=synthetic-secret',
      'http.target': '/uploads/a?access_token=synthetic-secret', 'http.request.header.authorization': ['Bearer synthetic-secret'], 'http.status_code': 401 });
    span.recordException(new Error('request /uploads/a?token=synthetic-secret'));
    span.setStatus({ code: 2, message: 'failed /uploads/a?token=synthetic-secret' });
    span.end(); await provider.forceFlush();
    expect(exported).toHaveLength(1);
    const output = exported[0];
    expect(output.spanContext().traceId).toHaveLength(32);
    expect(output.attributes['http.status_code']).toBe(401);
    expect(output.status.code).toBe(2);
    expect(JSON.stringify([output.attributes, output.events, output.status, output.resource.attributes])).not.toContain('synthetic-secret');
    // Also cover the disabled SDK's in-memory stats path.
    const { DistributedTracing } = require('../src/integrations/tracing');
    const tracing = new DistributedTracing();
    const { EventEmitter } = require('events');
    const res = Object.assign(new EventEmitter(), { statusCode: 401, send() {} });
    let calls = 0;
    tracing.middleware()({ method: 'GET', path: '/uploads/a', url: '/uploads/a?token=synthetic-secret', get: () => '' }, res, () => calls++);
    res.emit('finish');
    expect(calls).toBe(1); expect(tracing.getInMemoryStats().completed).toBe(1);
    expect(JSON.stringify(tracing.getInMemoryStats())).not.toContain('synthetic-secret');
  } finally { await provider.shutdown(); }
});
