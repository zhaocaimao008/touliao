import { describe, expect, it } from 'vitest';
import { buildMergedPayload, isForwardableMessage } from './mergedForward';

describe('merged forward payload', () => {
  it('filters unsafe message types and keeps at most 30 ordered items', () => {
    const messages = [
      { id: '1', type: 'text', content: 'hello', sender_id: 'u1', senderName: 'Alice', created_at: 10 },
      { id: '2', type: 'red_packet', content: '{}', sender_id: 'u2', senderName: 'Bob', created_at: 11 },
      ...Array.from({ length: 35 }, (_, i) => ({
        id: `f${i}`, type: 'file', content: `file-${i}.pdf`, sender_id: 'u1', senderName: 'Alice', created_at: 20 + i,
      })),
    ];

    const payload = buildMergedPayload(messages, {
      title: '项目群的聊天记录',
      labels: { file: '[文件]', image: '[图片]', video: '[视频]', voice: '[语音]', contact: '[名片]', merged: '[聊天记录]' },
    });

    expect(payload.title).toBe('项目群的聊天记录');
    expect(payload.items).toHaveLength(30);
    expect(payload.items[0]).toEqual({ mid: '1', type: 'text', sender: 'u1', senderName: 'Alice', snippet: 'hello', ts: 10 });
    expect(payload.items.some(item => item.type === 'red_packet')).toBe(false);
  });

  it('builds bounded human-readable snippets for supported rich messages', () => {
    const longText = '字'.repeat(90);
    const payload = buildMergedPayload([
      { id: 't', type: 'text', content: longText, sender_id: 'u1', sender_name: '甲', created_at: 1 },
      { id: 'v', type: 'voice', content: '', duration: 8, sender_id: 'u2', senderName: '乙', created_at: 2 },
      { id: 'c', type: 'contact_card', content: JSON.stringify({ username: '小明' }), sender_id: 'u3', senderName: '丙', created_at: 3 },
    ], {
      title: '3条消息',
      labels: { file: '[文件]', image: '[图片]', video: '[视频]', voice: '[语音]', contact: '[名片]', merged: '[聊天记录]', seconds: '秒' },
    });

    expect(payload.items[0].snippet).toBe('字'.repeat(80));
    expect(payload.items[1].snippet).toBe('[语音] 8秒');
    expect(payload.items[2].snippet).toBe('[名片] 小明');
    expect(isForwardableMessage({ type: 'system' })).toBe(false);
    expect(isForwardableMessage({ type: 'merged' })).toBe(true);
  });
});
