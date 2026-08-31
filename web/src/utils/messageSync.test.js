import { describe, expect, it, vi } from 'vitest';
import { applySyncEvents, catchUpConversation } from './messageSync';

describe('message cursor sync', () => {
  it('orders, deduplicates, edits and removes append-only events', () => {
    const events = [
      { server_sequence: 3, event_type: 'message_edited', message_id: 'a', payload: { content: 'edited' } },
      { server_sequence: 1, event_type: 'message_created', message_id: 'a', message: { id: 'a', content: 'old', server_sequence: 1 } },
      { server_sequence: 2, event_type: 'message_created', message_id: 'b', message: { id: 'b', content: 'b', server_sequence: 2 } },
      { server_sequence: 4, event_type: 'message_recalled', message_id: 'b' },
      { server_sequence: 1, event_type: 'message_created', message_id: 'a', message: { id: 'a', content: 'old', server_sequence: 1 } },
    ];
    expect(applySyncEvents([], events)).toEqual([{ id: 'a', content: 'edited', server_sequence: 1, edited: 1 }]);
  });

  it('continues until has_more is false and persists each page cursor', async () => {
    const pages = [
      { next_cursor: 500, has_more: true, messages: [] },
      { next_cursor: 1000, has_more: false, messages: [] },
    ];
    const saveCursor = vi.fn();
    const finalCursor = await catchUpConversation({
      conversationId: 'c', accountId: 'u', loadCursor: async () => 0,
      saveCursor, applyPage: async () => {}, requestPage: async () => pages.shift(),
    });
    expect(finalCursor).toBe(1000);
    expect(saveCursor.mock.calls.map(call => call[2])).toEqual([500, 1000]);
  });
});
