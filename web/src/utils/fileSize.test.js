import { describe, it, expect } from 'vitest';
import { humanFileSize } from './fileSize';

describe('humanFileSize', () => {
  it('空值返回空字符串', () => {
    expect(humanFileSize(undefined)).toBe('');
    expect(humanFileSize(null)).toBe('');
  });
  it('0 字节正确显示（不当作空值处理）', () => {
    expect(humanFileSize(0)).toBe('0 B');
  });
  it('字节/KB/MB/GB 分级正确', () => {
    expect(humanFileSize(500)).toBe('500 B');
    expect(humanFileSize(2048)).toBe('2.0 KB');
    expect(humanFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(humanFileSize(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB');
  });
});
