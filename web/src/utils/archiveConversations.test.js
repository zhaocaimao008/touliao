import { describe, expect, it } from 'vitest';
import { archiveUnreadTotal, splitArchivedConversations } from './archiveConversations';

describe('archive conversation helpers', () => {
  it('separates archived conversations without leaking them into the main list', () => {
    const result = splitArchivedConversations([
      { id: 'active', archived: 0 },
      { id: 'archived-number', archived: 1 },
      { id: 'archived-bool', archived: true },
    ]);

    expect(result.active.map(c => c.id)).toEqual(['active']);
    expect(result.archived.map(c => c.id)).toEqual(['archived-number', 'archived-bool']);
  });

  it('uses live unread values when available and caps invalid values at zero', () => {
    const conversations = [
      { id: 'a', unreadCount: 4 },
      { id: 'b', unreadCount: 3 },
      { id: 'c', unreadCount: -2 },
    ];

    expect(archiveUnreadTotal(conversations, { a: 7 })).toBe(10);
  });
});
