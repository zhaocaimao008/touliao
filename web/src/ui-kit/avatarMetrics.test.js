import { expect, it } from 'vitest';
import { avatarPx } from './avatarMetrics';

it('DS-004/005 resolves roles, legacy tiers and numeric props without a 40px call fallback', () => {
  expect(avatarPx('call')).toBe(88);
  expect(avatarPx('88')).toBe(88);
  expect(avatarPx(110)).toBe(110);
  expect(avatarPx('message')).toBe(36);
  expect(avatarPx('list')).toBe(avatarPx('md'));
  expect(avatarPx('hero')).toBe(92);
  for (const invalid of [NaN, Infinity, -1, 0, 'missing', null]) expect(avatarPx(invalid)).toBe(40);
});
