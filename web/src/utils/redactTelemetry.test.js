import { expect, test } from 'vitest';
import { redact } from './redactTelemetry';
test('Sentry requests, nested breadcrumbs, headers and error strings remove credentials', () => {
 const event={request:{query_string:'token=synthetic-secret',url:'/uploads/a?token=synthetic-secret&ok=1',headers:{Authorization:'Bearer synthetic-secret'}},breadcrumbs:[{data:{url:'https://fixture.invalid/?X-Amz-Signature=synthetic-secret'}}],exception:{values:[{value:'GET /a?token=synthetic-secret failed'}]}};
 expect(JSON.stringify(redact(event))).not.toContain('synthetic-secret');
 expect(redact(event).request.url).toContain('&ok=1');
 expect(event.request.url).toContain('synthetic-secret');
});
