import { expect, test } from 'vitest';
import { safeReturnPath } from './returnPath';
test.each([undefined, {}, 'https://evil.test', '//evil.test', '/\\evil.test', `/x${String.fromCharCode(0)}y`, ' /chat'])('rejects external or malformed return path %s', value => {
  expect(safeReturnPath(value)).toBe('/');
});
test('preserves same-origin conversation and invitation return paths', () => {
  expect(safeReturnPath('/join/token?accountWindow=123#message')).toBe('/join/token?accountWindow=123#message');
});
