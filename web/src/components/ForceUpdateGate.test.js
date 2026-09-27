import { describe, it, expect } from 'vitest';
import { versionLess } from './ForceUpdateGate';

describe('versionLess', () => {
  it('逐段数字比较', () => {
    expect(versionLess('8.1.9', '8.1.10')).toBe(true);
    expect(versionLess('8.1.35', '8.1.35')).toBe(false);
    expect(versionLess('8.2.0', '8.1.99')).toBe(false);
    expect(versionLess('8.1', '8.1.1')).toBe(true);
  });
});
