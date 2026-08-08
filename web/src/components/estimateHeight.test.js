import { describe, it, expect } from 'vitest';
import { estimateHeight, REPLY_MEDIA_HEIGHT, REPLY_TEXT_HEIGHT } from './estimateHeight';

// 回归防护：带引用预览的行，其首帧估算必须包含引用块高度。
// 否则 react-window 为该行预留高度过矮，下一行会落进本行引用区
// → 「回复图片后再发文字，文字渲染进回复图片消息里」。
const mk = (msg) => ({ type: 'message', msg });

// 单行文本首帧高度 = 行 padding(13) + 气泡上下 padding(22) + 1 行文本(22) = 57
const SINGLE_LINE_TEXT = 57;

describe('estimateHeight — 引用预览必须并入首帧高度', () => {
  it('单行纯文本消息 = 57(实测行高)，无引用附加', () => {
    expect(estimateHeight(mk({ type: 'text', content: 'hi' }))).toBe(SINGLE_LINE_TEXT);
  });

  it('多行文本按行数递增（每行 +22）', () => {
    const oneLine = estimateHeight(mk({ type: 'text', content: 'hi' }));
    const threeLines = estimateHeight(mk({ type: 'text', content: 'a\nb\nc' }));
    expect(threeLines).toBe(oneLine + 2 * 22);
    // 长文本(会换行)必须高于单行，杜绝下一行落进本行造成重叠
    const longText = estimateHeight(mk({ type: 'text', content: 'x'.repeat(80) }));
    expect(longText).toBeGreaterThan(oneLine);
  });

  it('连续消息(consecutive) 行 padding 更小，估算更矮', () => {
    const normal = estimateHeight({ type: 'message', msg: { type: 'text', content: 'hi' } });
    const consecutive = estimateHeight({ type: 'message', consecutive: true, msg: { type: 'text', content: 'hi' } });
    expect(consecutive).toBeLessThan(normal);
    expect(normal - consecutive).toBe(13 - 3); // 仅行 padding 之差
  });

  it('回复「图片」的文本消息 = 文本基线 + 图片引用高度', () => {
    const h = estimateHeight(mk({
      type: 'text', content: 'hi',
      replyTo: { type: 'image', file_url: '/x.jpg' },
    }));
    expect(h).toBe(SINGLE_LINE_TEXT + REPLY_MEDIA_HEIGHT);
    // 关键：必须严格高于无引用的同类消息，否则下一行会压进来
    expect(h).toBeGreaterThan(estimateHeight(mk({ type: 'text', content: 'hi' })));
  });

  it('回复「表情(sticker)」同样按媒体缩略图预留', () => {
    const h = estimateHeight(mk({
      type: 'text', content: 'hi',
      replyTo: { type: 'sticker', file_url: '/s.png' },
    }));
    expect(h).toBe(SINGLE_LINE_TEXT + REPLY_MEDIA_HEIGHT);
  });

  it('回复「文本」按单行文本占位预留（比媒体矮）', () => {
    const h = estimateHeight(mk({
      type: 'text', content: 'hi',
      replyTo: { type: 'text', content: '被引用的话' },
    }));
    expect(h).toBe(SINGLE_LINE_TEXT + REPLY_TEXT_HEIGHT);
    expect(REPLY_TEXT_HEIGHT).toBeLessThan(REPLY_MEDIA_HEIGHT);
  });

  it('被引用图片已撤回 → 走文本占位（不渲染缩略图）', () => {
    const h = estimateHeight(mk({
      type: 'text', content: 'hi',
      replyTo: { type: 'image', file_url: '/x.jpg', deleted: 1 },
    }));
    expect(h).toBe(SINGLE_LINE_TEXT + REPLY_TEXT_HEIGHT);
  });

  it('被引用图片缺 file_url → 走文本占位', () => {
    const h = estimateHeight(mk({
      type: 'text', content: 'hi',
      replyTo: { type: 'image' },
    }));
    expect(h).toBe(SINGLE_LINE_TEXT + REPLY_TEXT_HEIGHT);
  });

  it('图片消息带图片引用 = 图片基线(按最大高估算) + 图片引用高度', () => {
    const h = estimateHeight(mk({
      type: 'image', file_url: '/a.jpg',
      replyTo: { type: 'image', file_url: '/b.jpg' },
    }));
    expect(h).toBe(339 + REPLY_MEDIA_HEIGHT);
  });

  // 回归防护(2026-08 桌面端残影)：图片/视频按 CSS max-height(320)+行 padding(13)+底部留白(6)=339 估算，
  // 绝不低估——低估会让下一行按过小偏移压进图片区(重叠残影)。
  it('图片消息估算必须 ≥ 图片最大显示高 320 + 行 padding(含底部留白)', () => {
    const h = estimateHeight(mk({ type: 'image', file_url: '/a.jpg' }));
    expect(h).toBe(339);
    expect(h).toBeGreaterThanOrEqual(320 + 13 + 6);
  });

  it('视频消息同样按最大高估算，防下一行压进视频区', () => {
    const h = estimateHeight(mk({ type: 'video', file_url: '/v.mp4' }));
    expect(h).toBe(339);
    expect(h).toBeGreaterThanOrEqual(320 + 13 + 6);
  });

  it('语音/文件/红包/名片/表情 估算保持契约(不回归)', () => {
    expect(estimateHeight(mk({ type: 'voice' }))).toBe(72);
    expect(estimateHeight(mk({ type: 'file' }))).toBe(88);
    expect(estimateHeight(mk({ type: 'red_packet' }))).toBe(130);
    expect(estimateHeight(mk({ type: 'contact_card' }))).toBe(100);
    expect(estimateHeight(mk({ type: 'sticker' }))).toBe(146); // 140 + 6 媒体行底部留白
  });

  // 回归防护(2026-08 Windows 气泡挤压)：引用图片的行 = 图片基线 + 媒体引用高度，
  // 媒体引用估算必须覆盖 名字+缩略图+padding+margin 的真实高度(≈70)，否则下一行压进引用区。
  it('媒体引用高度 ≥ 70(实测引用块真实高度,防下一行挤压)', () => {
    expect(REPLY_MEDIA_HEIGHT).toBeGreaterThanOrEqual(70);
    // 带图片引用的图片消息：339 + 70
    const h = estimateHeight(mk({ type: 'image', file_url: '/a.jpg', replyTo: { type: 'image', file_url: '/b.jpg' } }));
    expect(h).toBe(339 + REPLY_MEDIA_HEIGHT);
    // 文本引用 < 媒体引用(文本占位更矮)
    expect(REPLY_TEXT_HEIGHT).toBeLessThan(REPLY_MEDIA_HEIGHT);
    expect(REPLY_TEXT_HEIGHT).toBeGreaterThanOrEqual(50);
  });

  it('divider / 空 item / 已删除消息 保持原契约', () => {
    expect(estimateHeight({ type: 'divider' })).toBe(36);
    expect(estimateHeight(null)).toBe(80);
    expect(estimateHeight(mk({ type: 'text', deleted: 1 }))).toBe(48);
  });

  it('拍一拍(nudge) 按单行小字精确预留，低于默认气泡高度', () => {
    const h = estimateHeight(mk({ type: 'nudge', content: '{}' }));
    expect(h).toBe(40);
    // 不得高于普通文本气泡(82)，否则拍一拍行会留白
    expect(h).toBeLessThan(estimateHeight(mk({ type: 'text', content: 'hi' })));
  });
});
