'use strict';
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const authSvc = require('../src/modules/auth/auth.service');
const adminSvc = require('../src/modules/admin/admin.service');
const conversations = require('../src/modules/conversations/conversations.service');
const { socketIp } = require('../src/utils/proxyTrust');
const { randomUUID, createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
let a,b,c,cid,msg,adminCookie;
const auth = u => `Bearer ${u.token}`;
const ackManager = { recordDelivery: jest.fn(async()=>true), recordRead: jest.fn(async()=>true), getMessageAckStatus: jest.fn(async()=>({delivered:1})) };
const queue = {getQueueStats:jest.fn(async()=>({pending:0})),getDLQMessages:jest.fn(async()=>[{payload:'private'}])};
const batch = {batchRecordDelivery:jest.fn(async()=>[]),batchRecordRead:jest.fn(async()=>[]),getStats:()=>({})};
beforeAll(async()=>{
  [a,b,c]=await Promise.all([makeUser(),makeUser(),makeUser()]);
  await befriend(a,b); cid=await privateConversation(a,b);
  msg=(await request(app).post(`/api/messages/${cid}`).set('Authorization',auth(a)).send({content:'ack secret',client_msg_id:randomUUID()})).body;
  app.set('ackManager',ackManager);app.set('msgQueue',queue);app.set('batchAckManager',batch);
  adminCookie=`${config.admin.cookieName}=${jwt.sign({admin:true,csrf:'audit'},config.adminJwtSecret,{expiresIn:60})}`;
});
beforeEach(()=>jest.clearAllMocks());
test.each(['delivery','read'])('ACK %s rejects outsider with no side effects',async(kind)=>{
  await request(app).post(`/api/reliability/ack/${kind}`).set('Authorization',auth(c)).send({messageId:msg.id}).expect(403);
  expect(ackManager.recordDelivery).not.toHaveBeenCalled();expect(ackManager.recordRead).not.toHaveBeenCalled();
  expect(db.prepare('SELECT 1 FROM message_reads WHERE message_id=? AND user_id=?').get(msg.id,c.userId)).toBeUndefined();
});
test.each(['delivery','read'])('ACK %s accepts a member',async(kind)=>{
  await request(app).post(`/api/reliability/ack/${kind}`).set('Authorization',auth(b)).send({messageId:msg.id}).expect(200);
});
test('ACK status hides outsiders and permits members',async()=>{
  await request(app).get('/api/reliability/ack/status').query({messageId:msg.id}).set('Authorization',auth(c)).expect(403);
  expect(ackManager.getMessageAckStatus).not.toHaveBeenCalled();
  await request(app).get('/api/reliability/ack/status').query({messageId:msg.id}).set('Authorization',auth(b)).expect(200);
});
test('mixed ACK batch is rejected atomically',async()=>{
  await request(app).post('/api/optimization/ack/batch').set('Authorization',auth(b)).send({deliveries:[msg.id],reads:['unknown']}).expect(403);
  expect(batch.batchRecordDelivery).not.toHaveBeenCalled();expect(batch.batchRecordRead).not.toHaveBeenCalled();
  await request(app).post('/api/optimization/ack/batch').set('Authorization',auth(b)).send({deliveries:[msg.id],reads:[msg.id]}).expect(200);
});
test.each([null,{},Array(501).fill('x')])('invalid ACK batches rejected: %j',async(reads)=>{
  await request(app).post('/api/optimization/ack/batch').set('Authorization',auth(b)).send({reads}).expect(400);
});
test.each(['dlq','queue/stats'])('%s requires separate admin credentials',async(route)=>{
  await request(app).get(`/api/reliability/${route}`).set('Authorization',auth(a)).expect(401);
  expect(queue.getQueueStats).not.toHaveBeenCalled();expect(queue.getDLQMessages).not.toHaveBeenCalled();
  await request(app).get(`/api/reliability/${route}`).set('Cookie',adminCookie).expect(200);
});
test('untrusted peer cannot forge forwarding chain',()=>{
  expect(socketIp({handshake:{address:'198.51.100.1',headers:{'x-forwarded-for':'203.0.113.2'}}})).toBe('198.51.100.1');
});
test('trusted loopback proxy separates clients and stops at untrusted hop',()=>{
  expect(socketIp({handshake:{address:'127.0.0.1',headers:{'x-forwarded-for':'203.0.113.2'}}})).toBe('203.0.113.2');
  expect(socketIp({handshake:{address:'127.0.0.1',headers:{'x-forwarded-for':'192.0.2.4, 198.51.100.1'}}})).toBe('198.51.100.1');
});
test('HTTP concurrent retry inserts one message and one sync event',async()=>{
  const key=randomUUID(),body={content:'same retry',client_msg_id:key};
  const results=await Promise.all(Array.from({length:8},()=>request(app).post(`/api/messages/${cid}`).set('Authorization',auth(a)).send(body)));
  expect(results.map(r=>r.status)).toEqual(Array(8).fill(200));
  expect(new Set(results.map(r=>r.body.id)).size).toBe(1);
  const id=results[0].body.id;
  expect(db.prepare('SELECT count(*) n FROM conversation_events WHERE message_id=?').get(id).n).toBe(1);
  await request(app).post(`/api/messages/${cid}`).set('Authorization',auth(a)).send({...body,content:'changed'}).expect(409);
});
test.each(['',null,{},'x'.repeat(129)])('HTTP rejects invalid explicit idempotency key %j',async(key)=>{
  await request(app).post(`/api/messages/${cid}`).set('Authorization',auth(a)).send({content:'invalid',client_msg_id:key}).expect(400);
});
test('idempotency key cannot bypass conversation membership',async()=>{
  await request(app).post(`/api/messages/${cid}`).set('Authorization',auth(c)).send({content:msg.content,client_msg_id:msg.client_msg_id}).expect(403);
});
test('same-second unread advances monotonically, hides individual deletion and clear',async()=>{
  const id=randomUUID();db.prepare("INSERT INTO conversations (id,type) VALUES (?,'private')").run(id);
  for(const u of [a,b])db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(id,u.userId);
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  for(const mid of ids)db.prepare("INSERT INTO messages (id,conversation_id,sender_id,content,created_at) VALUES (?,?,?,'same second',?)").run(mid,id,a.userId,1800000000);
  await conversations.markRead(null,b.userId,id,ids[0]);expect(conversations.unreadCounts(b.userId)[id]).toBe(2);
  await conversations.markRead(null,b.userId,id,ids[1]);expect(conversations.unreadCounts(b.userId)[id]).toBe(1);
  await conversations.markRead(null,b.userId,id,ids[0]);expect(conversations.unreadCounts(b.userId)[id]).toBe(1);
  db.prepare('INSERT INTO user_message_deletions (message_id,user_id) VALUES (?,?)').run(ids[2],b.userId);
  expect(conversations.unreadCounts(b.userId)[id]).toBeUndefined();
  await request(app).delete(`/api/messages/conversation/${id}/messages`).set('Authorization',auth(b)).expect(200);
  expect(conversations.unreadCounts(b.userId)[id]).toBeUndefined();
});
test('password change revokes wallet grants and all same-second tokens',async()=>{
  const u=await makeUser();const second=authSvc.signToken ? authSvc.signToken({id:u.userId,username:u.username}) : jwt.sign({id:u.userId,username:u.username,csrf:'audit'},config.jwtSecret,{expiresIn:60});
  authSvc.recordDeviceAccount('phase2-wallet',u.userId);
  const token=await authSvc.changePassword(u.userId,{oldPassword:u.password,newPassword:'newPass12345',currentToken:u.token});
  expect(()=>authSvc.switchAccount('phase2-wallet',u.userId,{headers:{}})).toThrow();
  for(const t of [u.token,second])await request(app).get('/api/auth/me').set('Authorization',`Bearer ${t}`).expect(401);
  await request(app).get('/api/auth/me').set('Authorization',`Bearer ${token}`).expect(200);
});
test.each(['reset','ban'])('admin %s revokes wallet and old token permanently',async(kind)=>{
  const u=await makeUser();authSvc.recordDeviceAccount('admin-wallet',u.userId);
  if(kind==='reset')await adminSvc.resetPassword(null,u.userId,'resetPass123');
  else {adminSvc.setBanned(null,u.userId,true);adminSvc.setBanned(null,u.userId,false);}
  expect(()=>authSvc.switchAccount('admin-wallet',u.userId,{headers:{}})).toThrow();
  await request(app).get('/api/auth/me').set('Authorization',auth(u)).expect(401);
});
async function initUpload(body=Buffer.from('plain upload regression')) {
  const hash=createHash('sha256').update(body).digest('hex');
  const r=await request(app).post(`/api/messages/${cid}/upload-init`).set('Authorization',auth(a)).send({filename:'audit.txt',size:body.length,hash,mime:'text/plain'}).expect(200);
  return {id:r.body.uploadId,body};
}
function put(id,body,offset=0,conv=cid,user=a){return request(app).put(`/api/messages/${conv}/upload-chunk/${id}`).query({offset}).set('Authorization',auth(user)).set('Content-Type','application/octet-stream').send(body);}
test('concurrent same-offset chunks never append twice; finish preserves bytes',async()=>{
  const {id,body}=await initUpload();
  const result=await Promise.all([put(id,body),put(id,body)]);expect(result.map(r=>r.status).sort()).toEqual([200,409]);
  expect(fs.readFileSync(path.join(config.uploadsRoot,'chunks',id+'.part'))).toEqual(body);
  const results=await Promise.all([0,1].map(()=>request(app).post(`/api/messages/${cid}/upload-finish/${id}`).set('Authorization',auth(a))));
  expect(results.filter(r=>r.status===200)).toHaveLength(1);
  expect(results.filter(r=>[404,409].includes(r.status))).toHaveLength(1);
});
test('upload offset and membership enforced on resume/status',async()=>{
  const {id,body}=await initUpload(Buffer.from('another upload'));
  await put(id,body,'0oops').expect(400);await put(id,body,0,'foreign-conversation').expect(403);
  await put(id,body,0,cid,c).expect(404);
  await request(app).get(`/api/messages/foreign-conversation/upload-status/${id}`).set('Authorization',auth(a)).expect(403);
});

test('login cannot mint a new authorization after a concurrent ban during bcrypt',async()=>{
  const u=await makeUser();let release;
  const compare=jest.spyOn(require('bcryptjs'),'compare').mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  try {
    const pending=authSvc.login({phone:u.phone,password:u.password},{headers:{}});
    adminSvc.setBanned(null,u.userId,true);release(true);
    await expect(pending).rejects.toMatchObject({status:403});
  } finally {compare.mockRestore();}
});
test('stale refresh and late wallet registration cannot inherit a newer auth version',async()=>{
  const u=await makeUser(),payload=jwt.decode(u.token);
  adminSvc.setBanned(null,u.userId,true);adminSvc.setBanned(null,u.userId,false);
  expect(()=>authSvc.refreshToken(payload)).toThrow();
  expect(()=>authSvc.recordDeviceAccount('late-wallet',u.userId,payload.auth_version)).toThrow();
});

test('stale upload lock from crashed process recovers and immutable init resumes',async()=>{
  const {id,body}=await initUpload(Buffer.from('crash lock upload'));
  const lock=path.join(config.uploadsRoot,'chunks',id+'.lock');fs.mkdirSync(lock);
  const old=new Date(Date.now()-60000);fs.utimesSync(lock,old,old);
  await put(id,body).expect(200);
  const hash=createHash('sha256').update(body).digest('hex');
  await request(app).post(`/api/messages/${cid}/upload-init`).set('Authorization',auth(a)).send({filename:'changed.txt',size:body.length,hash,mime:'text/plain'}).expect(409);
  const resume=await request(app).post(`/api/messages/${cid}/upload-init`).set('Authorization',auth(a)).send({filename:'audit.txt',size:body.length,hash,mime:'text/plain'}).expect(200);
  expect(resume.body.received).toBe(body.length);
});

test.each(['image','video','voice','file'])('%s cannot reference another conversation attachment',async(type)=>{
  const actor=await makeUser(), target=randomUUID();
  db.prepare("INSERT INTO conversations (id,type) VALUES (?,'group')").run(target);
  db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(target,actor.userId);
  const file_url=`/uploads/files/${randomUUID()}.bin`;
  require('../src/utils/fileRegistry').registerFile({path:file_url,ownerId:c.userId,conversationId:'foreign',kind:'files'});
  let handler;require('../src/realtime/handlers/file')({}, {user:{id:actor.userId},on:(_,fn)=>{handler=fn;}});
  const ack=await new Promise(resolve=>handler({conversationId:target,type,file_url,clientMsgId:randomUUID()},resolve));
  expect(ack.success).toBe(false);expect(ack.error).toMatch(/无权/);
  expect(db.prepare('SELECT 1 FROM messages WHERE file_url=?').get(file_url)).toBeUndefined();
});

test('concurrent file retries return one message and one synchronization event',async()=>{
  const file_url=`/uploads/files/${randomUUID()}.bin`;
  require('../src/utils/fileRegistry').registerFile({path:file_url,ownerId:a.userId,conversationId:cid,kind:'files'});
  let handler;require('../src/realtime/handlers/file')({to:()=>({emit(){}})}, {user:{id:a.userId},on:(_,fn)=>{handler=fn;}});
  const data={conversationId:cid,type:'file',file_url,clientMsgId:randomUUID()};
  const results=await Promise.all([1,2,3].map(()=>new Promise(resolve=>handler(data,resolve))));
  expect(results.every(r=>r.success)).toBe(true);
  expect(new Set(results.map(r=>r.message.id)).size).toBe(1);
  expect(db.prepare('SELECT COUNT(*) n FROM conversation_events WHERE message_id=?').get(results[0].message.id).n).toBe(1);
});

test('hard deletion cannot recycle read/clear watermarks for new messages',async()=>{
  const id=randomUUID();db.prepare("INSERT INTO conversations (id,type) VALUES (?,'group')").run(id);
  for(const u of [a,b])db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(id,u.userId);
  const service=require('../src/modules/messages/messages.service');
  const old=await service.send(null,id,a.userId,{content:'before hard deletion'});
  const oldRow=db.prepare('SELECT rowid FROM messages WHERE id=?').get(old.id).rowid;
  await conversations.markRead(null,b.userId,id,old.id);conversations.clearConversation(null,b.userId,id);
  db.prepare('DELETE FROM messages WHERE id=?').run(old.id);
  const fresh=await service.send(null,id,a.userId,{content:'after hard deletion'});
  expect(db.prepare('SELECT rowid FROM messages WHERE id=?').get(fresh.id).rowid).toBeGreaterThan(oldRow);
  expect(conversations.unreadCounts(b.userId)[id]).toBe(1);
  expect(JSON.stringify(require('../src/modules/messages/sync.service').syncConversation(id,b.userId))).toContain('after hard deletion');
});
test('personal deletion is absent from list unread count even without settings row',async()=>{
  const id=randomUUID(),mid=randomUUID();db.prepare("INSERT INTO conversations (id,type) VALUES (?,'group')").run(id);
  for(const u of [a,b])db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(id,u.userId);
  db.prepare("INSERT INTO messages (id,conversation_id,sender_id,content) VALUES (?,?,?,'deleted unread')").run(mid,id,a.userId);
  db.prepare('INSERT INTO user_message_deletions (message_id,user_id) VALUES (?,?)').run(mid,b.userId);
  const list=await request(app).get('/api/messages/conversations').set('Authorization',auth(b)).expect(200);
  expect(list.body.find(c=>c.id===id).unreadCount).toBe(0);
});
