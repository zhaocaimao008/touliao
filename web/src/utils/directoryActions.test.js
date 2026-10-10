import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { handleFriendRequest, unblockContact, saveFriendLabel, deleteFriendLabel, changeLabelMember } from './directoryActions';

const config = { signal: new AbortController().signal, _sessionContext: { owner: 'test' } };
const values = { name: 'Work', color: '#6D5AE6' };
beforeEach(() => {
  for (const method of ['post', 'put', 'delete']) vi.spyOn(axios, method).mockResolvedValue({ data: { success: true } });
});
afterEach(() => vi.restoreAllMocks());

test('friend request and unblock require the server acknowledgement and carry the owner scope', async () => {
  await handleFriendRequest('request-1', 'accepted', config);
  expect(axios.post).toHaveBeenCalledExactlyOnceWith('/api/users/friend-request/request-1/handle', { action: 'accepted' }, config);
  axios.delete.mockResolvedValueOnce({ data: { success: true, blocked: false } });
  await unblockContact('friend-1', config);
  expect(axios.delete).toHaveBeenCalledExactlyOnceWith('/api/users/block/friend-1', config);
});
test.each([{}, null, { success: false }, '<html>ok</html>'])('malformed success %j cannot remove a pending request or label', async data => {
  axios.post.mockResolvedValueOnce({ data }); axios.delete.mockResolvedValueOnce({ data });
  await expect(handleFriendRequest('request-1', 'accepted', config)).rejects.toThrow();
  await expect(deleteFriendLabel('label-1', config)).rejects.toThrow();
});
test.each([{ success: true }, { success: true, blocked: true }])('unblock %j cannot falsely remove a blocked user', async data => {
  axios.delete.mockResolvedValueOnce({ data }); await expect(unblockContact('friend-1', config)).rejects.toThrow();
});
test('label creation and editing retain confirmed server data', async () => {
  const saved = { id: 'label-1', ...values };
  axios.post.mockResolvedValueOnce({ data: { ...saved, members: [] } });
  axios.put.mockResolvedValueOnce({ data: saved });
  expect(await saveFriendLabel(null, values, config)).toEqual({ ...saved, members: [] });
  expect(await saveFriendLabel('label-1', values, config)).toEqual(saved);
  expect(axios.post).toHaveBeenCalledExactlyOnceWith('/api/friend-labels', values, config);
  expect(axios.put).toHaveBeenCalledExactlyOnceWith('/api/friend-labels/label-1', values, config);
});
test.each([{}, { id: '' }, { id: 'other', ...values }, { id: 'label-1', name: 'Wrong', color: values.color }])('invalid label edit %j cannot close the editor as saved', async data => {
  axios.put.mockResolvedValueOnce({ data }); await expect(saveFriendLabel('label-1', values, config)).rejects.toThrow();
});
test('membership changes require acknowledgement for the selected friend', async () => {
  const member = { id: 'friend-1', username: 'Alice' };
  axios.post.mockResolvedValueOnce({ data: member });
  expect(await changeLabelMember('label-1', 'friend-1', false, config)).toEqual(member);
  await changeLabelMember('label-1', 'friend-1', true, config);
  expect(axios.post).toHaveBeenCalledExactlyOnceWith('/api/friend-labels/label-1/members', { friendId: 'friend-1' }, config);
  expect(axios.delete).toHaveBeenCalledExactlyOnceWith('/api/friend-labels/label-1/members/friend-1', config);
});
test('an unrelated member or invalid removal acknowledgement cannot change a checkbox', async () => {
  axios.post.mockResolvedValueOnce({ data: { id: 'someone-else' } }); axios.delete.mockResolvedValueOnce({ data: {} });
  await expect(changeLabelMember('label-1', 'friend-1', false, config)).rejects.toThrow();
  await expect(changeLabelMember('label-1', 'friend-1', true, config)).rejects.toThrow();
});
