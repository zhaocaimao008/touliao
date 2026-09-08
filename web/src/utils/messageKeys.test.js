import { expect, it } from 'vitest';
import { createMessageKeys } from './messageKeys';
it('lost response retries retain their original message idempotency key', () => {
  const key = createMessageKeys(); expect(key('a', 'hello')).toBe(key('a', 'hello'));
});
it('different recipients and changed payloads use different keys', () => {
  const key = createMessageKeys(), first = key('a', 'hello');
  expect(key('b', 'hello')).not.toBe(first); expect(key('a', 'changed')).not.toBe(first);
});
it('a new user action may intentionally send identical content', () => {
  expect(createMessageKeys()('a', 'hello')).not.toBe(createMessageKeys()('a', 'hello'));
});
