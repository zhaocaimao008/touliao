'use strict';
/**
 * 回归（round48）：云直传预签名——拒绝浏览器会内联渲染/执行的 Content-Type，防 CDN 域存储型 XSS。
 *
 * bug：POST /api/upload/credential 的 contentType 完全由客户端指定，写入预签名后即固定为对象响应头。
 * 扩展名过白名单(.png 等)但 contentType 可伪成 text/html、image/svg+xml——云直传不经服务器、无魔数
 * 校验，对象在 CDN 域被浏览器当 HTML/JS 渲染 → 存储型 XSS(本地 /uploads 有 nosniff+附件下发兜底，
 * 云 CDN 不经该中间件)。isBrowserRenderableType 在预签名前把关。
 *
 * 重点覆盖：/xml/ 宽匹配会误伤 docx/xlsx/pptx 的 application/vnd.openxmlformats-... (含 "xml" 子串)，
 * 必须放行；只拦结构化 +xml 与危险精确类型。
 */
const { isBrowserRenderableType } = require('../src/utils/upload');

describe('云直传 contentType 存储型 XSS 防护（round48）', () => {
  test('危险可渲染类型被拦截', () => {
    for (const ct of [
      'text/html', 'application/xhtml+xml', 'image/svg+xml',
      'application/xml', 'text/xml', 'application/rss+xml',
      'application/javascript', 'text/javascript', 'application/ecmascript',
      'TEXT/HTML', 'image/svg+xml; charset=utf-8', '  text/html  ',
    ]) {
      expect(isBrowserRenderableType(ct)).toBe(true);
    }
  });

  test('正常媒体/文档/压缩类型放行', () => {
    for (const ct of [
      'image/png', 'image/jpeg', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/mp4',
      'application/pdf', 'application/zip', 'text/plain',
      'application/msword',
      // Office OOXML —— 含 "xml" 子串但安全，绝不能被误拦
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]) {
      expect(isBrowserRenderableType(ct)).toBe(false);
    }
  });

  test('非字符串输入安全返回 false', () => {
    expect(isBrowserRenderableType(undefined)).toBe(false);
    expect(isBrowserRenderableType(null)).toBe(false);
    expect(isBrowserRenderableType(123)).toBe(false);
    expect(isBrowserRenderableType({})).toBe(false);
  });
});
