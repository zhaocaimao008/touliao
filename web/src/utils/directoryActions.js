import axios from 'axios';

const requireData = (data, valid) => {
  if (!valid) throw new Error('Unconfirmed directory action');
  return data;
};
const validId = id => typeof id === 'string' && id.trim().length > 0;

export async function handleFriendRequest(id, action, config) {
  const { data } = await axios.post(`/api/users/friend-request/${id}/handle`, { action }, config);
  return requireData(data, data?.success === true);
}
export async function unblockContact(id, config) {
  const { data } = await axios.delete(`/api/users/block/${id}`, config);
  return requireData(data, data?.success === true && data.blocked === false);
}
export async function saveFriendLabel(id, values, config) {
  const { data } = id
    ? await axios.put(`/api/friend-labels/${id}`, values, config)
    : await axios.post('/api/friend-labels', values, config);
  return requireData(data, validId(data?.id) && (!id || data.id === id)
    && data.name === values.name && data.color === values.color);
}
export async function deleteFriendLabel(id, config) {
  const { data } = await axios.delete(`/api/friend-labels/${id}`, config);
  return requireData(data, data?.success === true);
}
export async function changeLabelMember(labelId, friendId, remove, config) {
  const { data } = remove
    ? await axios.delete(`/api/friend-labels/${labelId}/members/${friendId}`, config)
    : await axios.post(`/api/friend-labels/${labelId}/members`, { friendId }, config);
  return requireData(data, remove ? data?.success === true : data?.id === friendId);
}
