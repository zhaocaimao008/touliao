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
  message = (await auth(request(app).post(`/api/messages/${conv}`), a).send({type:'text',content:'SYNTHETIC_BURN_SECRET @'+b.username})).body;
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
  ['mentions', () => '/api/messages/mentions/me'],
  ['global search', () => '/api/messages/search?q=SYNTHETIC_BURN_SECRET'],
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
  await befriend(a,outsider);
  const group=await auth(request(app).post('/api/messages/conversation/group'),a).send({name:'synthetic permitted share',memberIds:[b.userId,outsider.userId]});
  const forwarded=await auth(request(app).post('/api/messages/forward'),a).send({msgId:up.body.id,conversationIds:[group.body.conversationId]});
  expect(forwarded.status).toBe(200);
  expect((await auth(request(app).get(up.body.file_url),b)).status).toBe(200); // Independent, explicitly authorized reference remains live.
});

test('write failure can retry; replay is harmless and does not corrupt other users', async () => {
  const m=await svc.send(null,conv,a.userId,{content:'SYNTHETIC retry',type:'text'});
  db.exec(`CREATE TRIGGER synthetic_delete_failure BEFORE INSERT ON user_message_deletions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`);
  try {
    await expect(svc.remove(null,b.userId,m.id,false,false,true)).rejects.toThrow();
    expect(db.prepare('SELECT 1 FROM user_message_deletions WHERE message_id=?').get(m.id)).toBeUndefined();
  } finally { db.exec('DROP TRIGGER synthetic_delete_failure'); }
  await svc.remove(null,b.userId,m.id,false,false,true);
  await Promise.all([svc.remove(null,b.userId,m.id,false,false,true),svc.remove(null,b.userId,m.id,false,false,true)]);
  expect(svc.history(conv,b.userId,{}).some(x=>x.id===m.id)).toBe(false);
  expect(svc.history(conv,a.userId,{}).some(x=>x.id===m.id)).toBe(true);
});

test('fresh server process still denies removed history without an in-memory timer or cleanup worker', () => {
  const {execFileSync}=require('child_process');
  const script=`const svc=require('./src/modules/messages/messages.service');
    const visible=svc.history(process.argv[1],process.argv[2],{});
    console.log('SYNTHETIC_RESULT:'+JSON.stringify({present:visible.some(m=>m.id===process.argv[3]),quoted:JSON.stringify(visible).includes('SYNTHETIC_BURN_SECRET')}));process.exit(0);`;
  const stdout=execFileSync(process.execPath,['-e',script,conv,b.userId,message.id],{cwd:require('path').resolve(__dirname,'..'),env:process.env,encoding:'utf8'});
  const line=stdout.split('\n').find(x=>x.startsWith('SYNTHETIC_RESULT:'));
  expect(JSON.parse(line.slice('SYNTHETIC_RESULT:'.length))).toEqual({present:false,quoted:false});
});

test('global removal clears old edit payloads as well as the authoritative body, idempotently', async () => {
  const m=await svc.send(null,conv,a.userId,{content:'SYNTHETIC original',type:'text'});
  await svc.edit(null,a.userId,m.id,'SYNTHETIC edited body');
  expect(JSON.stringify(db.prepare('SELECT payload FROM conversation_events WHERE message_id=?').all(m.id))).toContain('SYNTHETIC edited body');
  await svc.remove(null,a.userId,m.id,false,true,false);
  await svc.remove(null,a.userId,m.id,false,true,false);
  expect(db.prepare('SELECT content,file_url,deleted FROM messages WHERE id=?').get(m.id)).toEqual({content:'',file_url:'',deleted:2});
  expect(JSON.stringify(db.prepare('SELECT payload FROM conversation_events WHERE message_id=?').all(m.id))).not.toContain('SYNTHETIC');
  expect((await auth(request(app).get(`/api/messages/${conv}/sync?cursor=0`),b)).text).not.toContain('SYNTHETIC edited body');
});

test('authenticated attachment response is not made public immutable by CDN middleware', async () => {
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
  const up=await auth(request(app).post(`/api/messages/${conv}/upload`),a).attach('file',png,{filename:'synthetic.png',contentType:'image/png'});
  expect(up.status).toBe(200);
  const read=await auth(request(app).get(up.body.file_url),b);
  expect(read.status).toBe(200);expect(read.headers['cache-control']).toBe('private, no-store');
});

test('a disabled-by-default collection path cannot copy a personally removed source when enabled in the synthetic fixture', async () => {
  const old = db.prepare('SELECT value FROM admin_settings WHERE key=?').get('feature_collect');
  db.prepare('INSERT OR REPLACE INTO admin_settings(key,value) VALUES(?,?)').run('feature_collect','on');
  try {
    expect((await auth(request(app).post(`/api/messages/${message.id}/collect`),b).send({})).status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS n FROM collections WHERE user_id=?').get(b.userId).n).toBe(0);
  } finally {
    if (old) db.prepare('UPDATE admin_settings SET value=? WHERE key=?').run(old.value,'feature_collect');
    else db.prepare('DELETE FROM admin_settings WHERE key=?').run('feature_collect');
  }
});

test('existing batch removal clears old edit payloads too', async () => {
  const m=await svc.send(null,conv,a.userId,{content:'SYNTHETIC_BATCH_ORIGINAL',type:'text'});
  await svc.edit(null,a.userId,m.id,'SYNTHETIC_BATCH_EDIT');
  await svc.batchDelete(null,a.userId,{msgIds:[m.id],conversationId:conv});
  expect(db.prepare('SELECT content FROM messages WHERE id=?').get(m.id).content).toBe('');
  expect(JSON.stringify(db.prepare('SELECT payload FROM conversation_events WHERE message_id=?').all(m.id))).not.toContain('SYNTHETIC_BATCH_EDIT');
});
