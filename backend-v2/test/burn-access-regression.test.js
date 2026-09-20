'use strict';
// SOCIAL-011: deletion authorization is independent of the unresolved burn clock policy.
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const cache = require('../src/utils/cache');
const svc = require('../src/modules/messages/messages.service');
const auth = (r, u) => r.set('Authorization', `Bearer ${u.token}`);
let a, b, outsider, conv, message, reply;
beforeAll(async () => {
  a = await makeUser(); b = await makeUser(); outsider = await makeUser();
  await befriend(a, b); conv = await privateConversation(a, b);
  message = (await auth(request(app).post(`/api/messages/${conv}`), a).send({type:'text',content:'SYNTHETIC_BURN_SECRET'})).body;
  reply = (await auth(request(app).post(`/api/messages/${conv}`), a).send({type:'text',content:'allowed reply',reply_to_id:message.id})).body;
});
afterEach(() => jest.restoreAllMocks());
test('legal pre-removal access; unauthorized deletion rejected; recipient removal is idempotent and does not delete peer copy', async () => {
  expect(JSON.stringify((await auth(request(app).get(`/api/messages/${conv}`), b)).body)).toContain('SYNTHETIC_BURN_SECRET');
  expect((await auth(request(app).delete(`/api/messages/${message.id}`), outsider).send({forMe:true})).status).toBe(403);
  for (let i=0;i<2;i++) expect((await auth(request(app).delete(`/api/messages/${message.id}`), b).send({forMe:true})).status).toBe(200);
  expect(db.prepare('SELECT COUNT(*) AS n FROM user_message_deletions WHERE message_id=? AND user_id=?').get(message.id,b.userId).n).toBe(1);
  expect(JSON.stringify((await auth(request(app).get(`/api/messages/${conv}`), a)).body)).toContain('SYNTHETIC_BURN_SECRET');
});
test.each([
  ['history', () => `/api/messages/${conv}`],
  ['missed', () => '/api/messages/missed?after=1'],
  ['sync including older create events', () => `/api/messages/${conv}/sync?cursor=0`],
  ['around reply', () => `/api/messages/${conv}/around/${reply.id}`],
  ['export', () => `/api/messages/conversation/${conv}/export`],
  ['search', () => `/api/messages/conversation/${conv}/search?q=SYNTHETIC_BURN_SECRET`],
])('%s does not return removed body, including reply snapshots', async (_name, url) => {
  const r = await auth(request(app).get(url()), b);
  expect(r.status).toBe(200);
  expect(r.text).not.toContain('SYNTHETIC_BURN_SECRET');
});
test('stale cached search is reauthorized even if cache invalidation failed', async () => {
  jest.spyOn(cache,'get').mockResolvedValueOnce([message]);
  expect(await svc.searchInConversation(conv,b.userId,'SYNTHETIC_BURN_SECRET')).toEqual([]);
  jest.spyOn(cache,'get').mockResolvedValueOnce({results:[message],total:1});
  expect((await svc.searchGlobal(b.userId,{q:'SYNTHETIC_BURN_SECRET'})).results).toEqual([]);
});
test('pinned body is not an alternate access path', async () => {
  db.prepare('INSERT INTO pinned_messages(id,conversation_id,message_id,pinned_by) VALUES(?,?,?,?)').run('burn-pin-'+message.id,conv,message.id,a.userId);
  const r=await auth(request(app).get(`/api/messages/conversation/${conv}/pinned-messages`),b);
  expect(r.status).toBe(200); expect(r.text).not.toContain('SYNTHETIC_BURN_SECRET');
});
test('old file ticket is reauthorized; unrelated valid recipient retains attachment', async () => {
  const up=await auth(request(app).post(`/api/messages/${conv}/upload`),a)
    .attach('file',Buffer.from('SYNTHETIC attachment'),{filename:'burn.txt',contentType:'text/plain'});
  expect(up.status).toBe(200);
  const ticket=await auth(request(app).get('/api/uploads/ticket').query({file:up.body.file_url}),b);
  expect(ticket.status).toBe(200);
  expect((await request(app).get(ticket.body.url)).status).toBe(200);
  await auth(request(app).delete(`/api/messages/${up.body.id}`),b).send({forMe:true});
  expect((await request(app).get(ticket.body.url)).status).toBe(403);
  expect((await auth(request(app).get(up.body.file_url),b)).status).toBe(403);
  expect((await auth(request(app).get(up.body.file_url),a)).status).toBe(200);
});
