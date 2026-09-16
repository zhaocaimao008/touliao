import { describe, expect, it } from 'vitest';
import { MAX_MOMENT_VIDEO_BYTES, validateMomentVideo } from './momentMedia';

describe('moment video validation', () => {
  it('accepts a non-empty supported video within the server limit', () => {
    expect(validateMomentVideo({ name: 'clip.mp4', type: 'video/mp4', size: 1024 })).toBe(null);
    expect(validateMomentVideo({ name: 'camera.mkv', type: '', size: 1024 })).toBe(null);
  });

  it('rejects empty, oversized, and non-video files before upload', () => {
    expect(validateMomentVideo({ name: 'empty.mp4', type: 'video/mp4', size: 0 })).toBe('empty');
    expect(validateMomentVideo({ name: 'huge.mp4', type: 'video/mp4', size: MAX_MOMENT_VIDEO_BYTES + 1 })).toBe('too-large');
    expect(validateMomentVideo({ name: 'notes.txt', type: 'text/plain', size: 100 })).toBe('unsupported');
  });
});
