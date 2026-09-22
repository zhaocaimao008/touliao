const legalConsent = require('../../backend-v2/test/legal-consent.cjs');
const axios  = require('axios');
const cfg    = require('../config');

// 用账号对象（已有 cookie）直接创建客户端，不调用 login
function clientFromAccount(account) {
  const client = makeClient();
  client._setCookie(account.cookie);
  return client;
}

// 创建带 cookie jar 的 axios 实例
function makeClient() {
  let cookie = '';
  const client = axios.create({
    baseURL:        cfg.BASE_URL,
    timeout:        10000,
    withCredentials: true,
  });

  // 拦截响应，自动保存 Set-Cookie
  client.interceptors.response.use(res => {
    const sc = res.headers['set-cookie'];
    if (sc) {
      const match = sc.join(';').match(/vxin_token=([^;]+)/);
      if (match) cookie = `vxin_token=${match[1]}`;
    }
    return res;
  });

  // 拦截请求，自动带 Cookie
  client.interceptors.request.use(req => {
    if (cookie) req.headers['Cookie'] = cookie;
    return req;
  });

  client.getCookie  = () => cookie;
  client._setCookie = (c) => { cookie = c; };
  return client;
}

async function register(client, username, phone, password) {
  const r = await client.post('/api/auth/register', { username, phone, password, legalConsent });
  return r.data;
}

async function login(client, phone, password) {
  const r = await client.post('/api/auth/login', { phone, password, legalConsent });
  return r.data;
}

async function getMe(client) {
  const r = await client.get('/api/auth/me');
  return r.data;
}

async function sendFriendRequest(client, toId) {
  const r = await client.post('/api/users/friend-request', { toId });
  return r.data;
}

async function acceptFriendRequest(client, reqId) {
  const r = await client.post(`/api/users/friend-request/${reqId}/handle`, { action: 'accepted' });
  return r.data;
}

async function getFriendRequests(client) {
  const r = await client.get('/api/users/friend-requests');
  return r.data;
}

async function getContacts(client) {
  const r = await client.get('/api/users/contacts');
  return r.data;
}

async function createPrivateConv(client, userId) {
  const r = await client.post('/api/messages/conversation/private', { userId });
  return r.data;
}

async function createGroup(client, name, memberIds) {
  const r = await client.post('/api/messages/conversation/group', { name, memberIds });
  return r.data;
}

async function getConversations(client) {
  const r = await client.get('/api/messages/conversations');
  return r.data;
}

async function getMessages(client, convId, params = {}) {
  const r = await client.get(`/api/messages/${convId}`, { params });
  return r.data;
}

async function deleteMessage(client, msgId) {
  const r = await client.delete(`/api/messages/${msgId}`, { data: { forEveryone: true } });
  return r.data;
}

async function searchUsers(client, q) {
  const r = await client.get('/api/users/search', { params: { q } });
  return r.data;
}

async function markRead(client, convId, messageId) {
  const r = await client.post(`/api/messages/conversation/${convId}/read`, { messageId });
  return r.data;
}

async function getUnreadCounts(client) {
  const r = await client.get('/api/messages/unread-counts');
  return r.data;
}

module.exports = {
  makeClient, clientFromAccount, register, login, getMe,
  sendFriendRequest, acceptFriendRequest, getFriendRequests, getContacts,
  createPrivateConv, createGroup, getConversations, getMessages,
  deleteMessage, searchUsers, markRead, getUnreadCounts,
};
