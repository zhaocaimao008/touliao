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
