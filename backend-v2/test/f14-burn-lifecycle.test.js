const { db,fixture,messages,conv,sync }=require('./batch2-fixture.cjs');
afterAll(async()=>require('../src/db/writer').shutdown());
test('sender policy is captured; sender read cannot burn before recipient first read',async()=>{
 const f=fixture();await conv.setBurnAfter(f.a,f.id,60);
 const m=await messages.send(null,f.id,f.a,{content:'burn-secret'});
 expect(m.burn_after).toBe(60);
 db.prepare('UPDATE messages SET created_at=? WHERE id=?').run(Math.floor(Date.now()/1000)-3600,m.id);
 await conv.markRead(null,f.a,f.id,m.id);
 expect(db.prepare('SELECT burn_expires_at FROM messages WHERE id=?').get(m.id).burn_expires_at).toBeNull();
 await conv.markRead(null,f.b,f.id,m.id);
 const deadline=db.prepare('SELECT burn_expires_at FROM messages WHERE id=?').get(m.id).burn_expires_at;
 expect(deadline).toBeGreaterThan(Math.floor(Date.now()/1000));
 await conv.markRead(null,f.b,f.id,m.id);
 expect(db.prepare('SELECT burn_expires_at FROM messages WHERE id=?').get(m.id).burn_expires_at).toBe(deadline);
 const burn=require('../src/modules/messages/burn.service');
 burn.expireDueMessages(null,deadline);
 expect(messages.history(f.id,f.b,{})).toHaveLength(0);
 expect(JSON.stringify(sync.syncConversation(f.id,f.b,{}))).not.toContain('burn-secret');
 expect(db.prepare('SELECT content FROM messages WHERE id=?').get(m.id).content).toBe('');
});
test('read authorization, concurrent retries, editing, restart and expiry are idempotent',async()=>{
 const f=fixture(),other=fixture();await conv.setBurnAfter(f.a,f.id,60);
 const m=await messages.send(null,f.id,f.a,{content:'burn-before-edit'});
 await messages.edit(null,f.a,m.id,'burn-after-edit');
 expect(await conv.markRead(null,other.a,f.id,m.id)).toEqual({readAt:0,lastReadMessageId:null});
 expect(db.prepare('SELECT burn_expires_at FROM messages WHERE id=?').get(m.id).burn_expires_at).toBeNull();
 await Promise.all([conv.markRead(null,f.b,f.id,m.id),conv.markRead(null,f.b,f.id,m.id)]);
 expect(db.prepare("SELECT * FROM conversation_events WHERE message_id=? AND event_type='message_burn_started'").all(m.id)).toHaveLength(1);
 await conv.setBurnAfter(f.a,f.id,0);
 const deadline=db.prepare('SELECT burn_expires_at FROM messages WHERE id=?').get(m.id).burn_expires_at;
 const burn=require('../src/modules/messages/burn.service');burn.expireDueMessages(null,deadline);burn.expireDueMessages(null,deadline);
 expect(JSON.stringify(sync.syncConversation(f.id,f.a,{}))).not.toContain('burn-after-edit');
 expect(db.prepare("SELECT * FROM conversation_events WHERE message_id=? AND event_type='message_vanished'").all(m.id)).toHaveLength(1);
 expect(db.prepare('SELECT * FROM messages_fts WHERE message_id=?').all(m.id)).toHaveLength(0);
 const normal=await messages.send(null,f.id,f.a,{content:'normal-after-disabled'});expect(normal.burn_after).toBe(0);
});
test('ephemeral body cannot be forwarded or collected; normal messages remain allowed',async()=>{
 const f=fixture();await conv.setBurnAfter(f.a,f.id,60);
 const m=await messages.send(null,f.id,f.a,{content:'no-copy'});
 expect((await messages.forward(null,f.a,{msgId:m.id,conversationIds:[f.id]})).status).toBe('failed');
 await expect(messages.collect(f.a,m.id)).rejects.toThrow('阅后即焚');
 await conv.setBurnAfter(f.a,f.id,0);const normal=await messages.send(null,f.id,f.a,{content:'copy-allowed'});
 expect((await messages.forward(null,f.a,{msgId:normal.id,conversationIds:[f.id]})).status).toBe('success');
});
test('attachment ticket/access is allowed before expiry and denied after, including thumbnail',async()=>{
 const {app,request}=require('./f02-inprocess-http.cjs');
 const jwt=require('jsonwebtoken'),config=require('../src/config');
 const f=fixture();await conv.setBurnAfter(f.a,f.id,60);
 const path=`/uploads/files/${f.id}.png`,thumb=`/uploads/files/${f.id}_thumb.webp`;
 const {registerFile,canReferenceFile}=require('../src/utils/fileRegistry');
 for(const url of [path,thumb]) registerFile({path:url,ownerId:f.a,conversationId:f.id,kind:'files'});
 const m=await messages.saveUploadedFile(null,f.id,f.a,{type:'image',content:'synthetic.png',fileUrl:path});
 const token=jwt.sign({id:f.b,csrf:'fixture'},config.jwtSecret,{expiresIn:'1h'});
 const ticket=url=>request(app).get(`/api/uploads/ticket?file=${encodeURIComponent(url)}`).set('Authorization',`Bearer ${token}`);
 expect((await ticket(path)).status).toBe(200);expect((await ticket(thumb)).status).toBe(200);
 await conv.markRead(null,f.b,f.id,m.id);
 require('../src/modules/messages/burn.service').expireDueMessages(null,db.prepare('SELECT burn_expires_at FROM messages WHERE id=?').get(m.id).burn_expires_at);
 expect((await ticket(path)).status).toBe(403);expect((await ticket(thumb)).status).toBe(403);
 expect(canReferenceFile(path,f.a)).toBe(false);
 expect((await request(app).get(path).set('Authorization',`Bearer ${token}`)).status).toBe(403);
});
test('delayed cache invalidation cannot serve a burned search body',async()=>{
 const f=fixture();await conv.setBurnAfter(f.a,f.id,60);
 const m=await messages.send(null,f.id,f.a,{content:'cachedburnsecret'});
 await conv.markRead(null,f.b,f.id,m.id);
 require('../src/modules/messages/burn.service').expireDueMessages(null,db.prepare('SELECT burn_expires_at FROM messages WHERE id=?').get(m.id).burn_expires_at);
 const cache=require('../src/utils/cache');const spy=jest.spyOn(cache,'get').mockResolvedValue([m]);
 try { expect(JSON.stringify(await messages.searchInConversation(f.id,f.b,'cachedburnsecret'))).not.toContain('cachedburnsecret'); }
 finally {spy.mockRestore()}
});
