import { describe, expect, it } from 'vitest';
import {
  canViewReadStatus,
  createReadStatusModel,
  readUserIdsForMessage,
} from './readStatus';

describe('read status helpers', () => {
  it('only offers details for persisted, visible text/image/file messages sent by me', () => {
    const mine = { id: 'm1', sender_id: 'me', type: 'text' };

    expect(canViewReadStatus(mine, 'me')).toBe(true);
    expect(canViewReadStatus({ ...mine, type: 'image' }, 'me')).toBe(true);
    expect(canViewReadStatus({ ...mine, type: 'file' }, 'me')).toBe(true);
    expect(canViewReadStatus({ ...mine, type: 'voice' }, 'me')).toBe(false);
    expect(canViewReadStatus({ ...mine, sender_id: 'other' }, 'me')).toBe(false);
    expect(canViewReadStatus({ ...mine, deleted: 1 }, 'me')).toBe(false);
    expect(canViewReadStatus({ ...mine, _tempId: 'pending' }, 'me')).toBe(false);
  });

  it('defensively extracts the requested message read-user list', () => {
    expect(readUserIdsForMessage({ readStates: { m1: ['u1', 2, null, 'u1'] } }, 'm1'))
      .toEqual(['u1', '2']);
    expect(readUserIdsForMessage({ readStates: [] }, 'm1')).toEqual([]);
    expect(readUserIdsForMessage(null, 'm1')).toEqual([]);
  });

  it('resolves private-chat read state against the other participant', () => {
    const model = createReadStatusModel({
      conversation: { type: 'private', otherUser: { id: 'peer', username: 'Peer' } },
      members: [],
      currentUserId: 'me',
      message: { sender_id: 'me' },
      readUserIds: ['peer'],
    });

    expect(model).toEqual({ type: 'private', isRead: true, peerName: 'Peer' });
  });

  it('uses a non-empty reader list when an older private conversation lacks otherUser metadata', () => {
    const model = createReadStatusModel({
      conversation: { type: 'private' },
      members: [],
      currentUserId: 'me',
      message: { sender_id: 'me' },
      readUserIds: ['peer'],
    });

    expect(model.isRead).toBe(true);
  });

  it('maps group readers to members and excludes the sender from the recipient total', () => {
    const model = createReadStatusModel({
      conversation: { type: 'group' },
      members: [
        { id: 'me', username: 'Me' },
        { id: 'u1', username: 'Alice', avatar: 'a.png' },
        { id: 'u2', username: 'Bob' },
      ],
      currentUserId: 'me',
      message: { sender_id: 'me' },
      readUserIds: ['u2', 'unknown', 'me'],
    });

    expect(model.type).toBe('group');
    expect(model.readCount).toBe(2);
    expect(model.recipientCount).toBe(2);
    expect(model.readers).toEqual([
      { id: 'u2', name: 'Bob', avatar: '' },
      { id: 'unknown', name: '', avatar: '' },
    ]);
  });
});
