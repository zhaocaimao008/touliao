import { describe, it, expect } from 'vitest';

// vitest.config.mjs 用 environment:'node'（无 DOM，纯逻辑测试专用），但 url.js
// 顶层 import 的 config.js 在模块求值时就访问 window.__ELECTRON_CONFIG__——
// getThumbUrl 本身是纯字符串函数、不依赖 window，这里只是让整个文件能被 import。
if (typeof window === 'undefined') globalThis.window = {};

const { getThumbUrl } = await import('./url');

describe('getThumbUrl（缩略图 URL 推导，纯字符串变换，见 backend-v2 generateThumbnail 命名约定）', () => {
  it('本站上传文件路径：扩展名替换为 _thumb.webp', () => {
    expect(getThumbUrl('/uploads/files/abc-123.jpg')).toBe('/uploads/files/abc-123_thumb.webp');
    expect(getThumbUrl('/uploads/avatars/xyz.png')).toBe('/uploads/avatars/xyz_thumb.webp');
    expect(getThumbUrl('/uploads/moments/uuid-with-hyphens.webp')).toBe('/uploads/moments/uuid-with-hyphens_thumb.webp');
  });

  it('已经是缩略图 URL：原样返回，不重复推导', () => {
    expect(getThumbUrl('/uploads/files/abc-123_thumb.webp')).toBe('/uploads/files/abc-123_thumb.webp');
  });

  it('非 /uploads/ 路径（外部 URL/data URI）：原样返回', () => {
    expect(getThumbUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(getThumbUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    expect(getThumbUrl('/api/users/me/qrcode')).toBe('/api/users/me/qrcode');
  });

  it('空/非法输入：原样返回，不抛异常', () => {
    expect(getThumbUrl(null)).toBe(null);
    expect(getThumbUrl(undefined)).toBe(undefined);
    expect(getThumbUrl('')).toBe('');
    expect(getThumbUrl(123)).toBe(123);
  });

  it('无扩展名的 /uploads/ 路径：不匹配则原样返回', () => {
    expect(getThumbUrl('/uploads/files/noext')).toBe('/uploads/files/noext');
  });
});
