import { beforeEach, expect, test, vi } from 'vitest';
import { loadOutbox, upsertOutbox, removeFromOutbox } from './outbox';

const a = { server: 'https://one.test', accountId: 'A' };
const b = { ...a, accountId: 'B' };
const other = { ...a, server: 'https://two.test' };
const msg = { id: 'failed-1', _tempId: 'failed-1', sender_id: 'A', conversation_id: 'group', type: 'text', content: 'private failed text', _status: 'error' };
beforeEach(() => {
  const storage = new Map();
  vi.stubGlobal('localStorage', { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) });
});

test.each(['group', 'dm-a-b'])('owner and server isolation survives restoring %s', conv => {
  upsertOutbox(conv, { ...msg, conversation_id: conv }, a);
  expect(loadOutbox(conv, b)).toEqual([]);
  expect(loadOutbox(conv, other)).toEqual([]);
  expect(loadOutbox(conv, a).map(m => m.content)).toEqual(['private failed text']);
  removeFromOutbox(conv, msg.id, b);
  expect(loadOutbox(conv, a)).toHaveLength(1);
});

test('rejects foreign sender and missing owner', () => {
  upsertOutbox('group', msg, b);
  upsertOutbox('group', msg);
  expect(loadOutbox('group', b)).toEqual([]);
  expect(loadOutbox('group')).toEqual([]);
});

test('legacy rows without server evidence remain quarantined intact', () => {
  const raw = JSON.stringify([msg]);
  localStorage.setItem('outbox_group', raw);
  expect(loadOutbox('group', a)).toEqual([]);
  expect(loadOutbox('group', b)).toEqual([]);
  expect(localStorage.getItem('outbox_group')).toBe(raw);
});

test('failed text is retained during sending until explicit removal', () => {
  for (let i = 0; i < 3; i++) upsertOutbox('group', { ...msg, id: `f-${i}`, _tempId: `f-${i}` }, a);
  upsertOutbox('group', { ...msg, id: 'f-0', _tempId: 'f-0', _status: 'sending' }, a);
  expect(loadOutbox('group', a)).toHaveLength(3);
  removeFromOutbox('group', 'f-0', a);
  expect(loadOutbox('group', a)).toHaveLength(2);
});

test('50-item limit remains per owner and cannot evict another account queue', () => {
  upsertOutbox('group', { ...msg, sender_id: 'B' }, b);
  for (let i = 0; i < 51; i++) upsertOutbox('group', { ...msg, id: `f-${i}`, _tempId: `f-${i}` }, a);
  expect(loadOutbox('group', a)).toHaveLength(50);
  expect(loadOutbox('group', a)[0].id).toBe('f-1');
  expect(loadOutbox('group', b)).toHaveLength(1);
});
