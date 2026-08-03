import { describe, it, expect } from 'vitest';
import { estimateHeight, REPLY_MEDIA_HEIGHT, REPLY_TEXT_HEIGHT } from './estimateHeight';

// 回归防护：带引用预览的行，其首帧估算必须包含引用块高度。
// 否则 react-window 为该行预留高度过矮，下一行会落进本行引用区
// → 「回复图片后再发文字，文字渲染进回复图片消息里」。
const mk = (msg) => ({ type: 'message', msg });

describe('estimateHeight — 引用预览必须并入首帧高度', () => {
  it('纯文本消息 = 82，无引用附加', () => {
    expect(estimateHeight(mk({ type: 'text', content: 'hi' }))).toBe(82);
  });

  it('回复「图片」的文本消息 = 文本基线 + 图片引用高度', () => {
    const h = estimateHeight(mk({
      type: 'text', content: 'hi',
      replyTo: { type: 'image', file_url: '/x.jpg' },
    }));
    expect(h).toBe(82 + REPLY_MEDIA_HEIGHT);
    // 关键：必须严格高于无引用的同类消息，否则下一行会压进来
    expect(h).toBeGreaterThan(estimateHeight(mk({ type: 'text', content: 'hi' })));
  });

  it('回复「表情(sticker)」同样按媒体缩略图预留', () => {
    const h = estimateHeight(mk({
      type: 'text', content: 'hi',
      replyTo: { type: 'sticker', file_url: '/s.png' },
    }));
    expect(h).toBe(82 + REPLY_MEDIA_HEIGHT);
  });

  it('回复「文本」按单行文本占位预留（比媒体矮）', () => {
    const h = estimateHeight(mk({
      type: 'text', content: 'hi',
      replyTo: { type: 'text', content: '被引用的话' },
    }));
    expect(h).toBe(82 + REPLY_TEXT_HEIGHT);
    expect(REPLY_TEXT_HEIGHT).toBeLessThan(REPLY_MEDIA_HEIGHT);
  });

  it('被引用图片已撤回 → 走文本占位（不渲染缩略图）', () => {
    const h = estimateHeight(mk({
      type: 'text', content: 'hi',
      replyTo: { type: 'image', file_url: '/x.jpg', deleted: 1 },
    }));
    expect(h).toBe(82 + REPLY_TEXT_HEIGHT);
  });

  it('被引用图片缺 file_url → 走文本占位', () => {
    const h = estimateHeight(mk({
      type: 'text', content: 'hi',
      replyTo: { type: 'image' },
    }));
    expect(h).toBe(82 + REPLY_TEXT_HEIGHT);
  });

  it('图片消息带图片引用 = 图片基线 + 图片引用高度', () => {
    const h = estimateHeight(mk({
      type: 'image', file_url: '/a.jpg',
      replyTo: { type: 'image', file_url: '/b.jpg' },
    }));
    expect(h).toBe(260 + REPLY_MEDIA_HEIGHT);
  });

  it('divider / 空 item / 已删除消息 保持原契约', () => {
    expect(estimateHeight({ type: 'divider' })).toBe(36);
    expect(estimateHeight(null)).toBe(80);
    expect(estimateHeight(mk({ type: 'text', deleted: 1 }))).toBe(48);
  });
});
