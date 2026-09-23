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
test('read authorization, concurrent retries, editing and expiry are idempotent',async()=>{
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
test('export filters burn bodies before expiry while normal text remains exportable',async()=>{
 const f=fixture();await conv.setBurnAfter(f.a,f.id,60);
 await messages.send(null,f.id,f.a,{content:'export-burn-'+f.id});
 await conv.setBurnAfter(f.a,f.id,0);await messages.send(null,f.id,f.a,{content:'export-normal-'+f.id});
 const result=messages.exportConversation(f.id,f.b);
 expect(result).not.toContain('export-burn-'+f.id);expect(result).toContain('export-normal-'+f.id);
});
test.each(['history','sync'])('%s delivery starts the recipient deadline without any read ack',async route=>{
 const f=fixture();await conv.setBurnAfter(f.a,f.id,60);
 const m=await messages.send(null,f.id,f.a,{content:'no-ack-'+f.id});
 messages.history(f.id,f.a,{});
 expect(db.prepare('SELECT burn_expires_at FROM messages WHERE id=?').get(m.id).burn_expires_at).toBeNull();
 const socket=require('./batch2-fixture.cjs').io();
 const get=()=>route==='history'?messages.history(f.id,f.b,{},socket):sync.syncConversation(f.id,f.b,{},socket).messages.map(e=>e.message).filter(Boolean);
 const first=get().find(x=>x.id===m.id);
 expect(first.content).toBe('no-ack-'+f.id);expect(first.burn_expires_at-first.burn_read_at).toBe(60);
 expect(get().find(x=>x.id===m.id).burn_expires_at).toBe(first.burn_expires_at);
 expect(socket.events.filter(e=>e.name==='message_burn_started')).toHaveLength(1);
 require('../src/modules/messages/burn.service').expireDueMessages(null,first.burn_expires_at);
 expect(JSON.stringify(get())).not.toContain('no-ack-'+f.id);
});
test('fresh process startup expires persisted deadlines after restart; whole database has no old plaintext',async()=>{
 const f=fixture(),secrets=['restart-original-'+f.id,'restart-edit-'+f.id];await conv.setBurnAfter(f.a,f.id,60);
 const m=await messages.send(null,f.id,f.a,{content:secrets[0]});await messages.edit(null,f.a,m.id,secrets[1]);
 await conv.markRead(null,f.b,f.id,m.id);
 db.prepare('UPDATE messages SET burn_expires_at=1 WHERE id=?').run(m.id);
 const child=require('child_process').spawnSync(process.execPath,['-e',`require(${JSON.stringify(require.resolve('../src/modules/messages/burn.service'))}).startBurnExpiry();process.exit(0)`],{cwd:'/tmp',env:process.env,timeout:10000,stdio:'inherit'});
 expect(child.error).toBeUndefined();expect(child.status).toBe(0);
 expect(require('./batch2-fixture.cjs').plaintextHits(secrets)).toEqual([]);
 expect(db.prepare("SELECT COUNT(*) AS n FROM conversation_events WHERE message_id=? AND event_type='message_vanished'").get(m.id).n).toBe(1);
});
test('sender token and preissued media tickets lose original and thumbnail access after expiry',async()=>{
 const {app,request}=require('./f02-inprocess-http.cjs'),fs=require('fs'),path=require('path');
 const config=require('../src/config'),jwt=require('jsonwebtoken');
 const f=fixture();await conv.setBurnAfter(f.a,f.id,60);
 const original=`/uploads/files/burn_${f.id}.png`,thumb=`/uploads/files/burn_${f.id}_thumb.webp`;
 const neighbour=`/uploads/files/burnX${f.id}.png`;
 const {registerFile,canReferenceFile}=require('../src/utils/fileRegistry');
 for(const url of [original,thumb,neighbour]) {
  registerFile({path:url,ownerId:f.a,conversationId:f.id,kind:'files'});
  const disk=path.join(config.uploadsRoot,url.slice('/uploads/'.length));fs.mkdirSync(path.dirname(disk),{recursive:true});fs.writeFileSync(disk,'synthetic media');
 }
 const m=await messages.saveUploadedFile(null,f.id,f.a,{type:'image',content:'synthetic.png',fileUrl:original});
 await conv.setBurnAfter(f.a,f.id,0);
 await messages.saveUploadedFile(null,f.id,f.a,{type:'image',content:'neighbour.png',fileUrl:neighbour});
 expect(canReferenceFile(original,f.a)).toBe(false); // cannot plant an active burn attachment in a permanent message
 const token=jwt.sign({id:f.a,csrf:'fixture'},config.jwtSecret,{expiresIn:'1h'});
 const ticket=url=>request(app).get(`/api/uploads/ticket?file=${encodeURIComponent(url)}`).set('Authorization',`Bearer ${token}`);
 const issued=[];
 for(const url of [original,thumb]) {const result=await ticket(url);expect(result.status).toBe(200);issued.push(result.body.url);expect((await request(app).get(result.body.url)).status).toBe(200);expect((await request(app).get(url).set('Authorization',`Bearer ${token}`)).status).toBe(200);}
 await conv.markRead(null,f.b,f.id,m.id);require('../src/modules/messages/burn.service').expireDueMessages(null,db.prepare('SELECT burn_expires_at FROM messages WHERE id=?').get(m.id).burn_expires_at);
 for(const url of [original,thumb]) {expect((await ticket(url)).status).toBe(403);expect((await request(app).get(url).set('Authorization',`Bearer ${token}`)).status).toBe(403);expect(canReferenceFile(url,f.a)).toBe(false);}
 for(const url of issued) expect((await request(app).get(url)).status).toBe(403);
 expect((await ticket(neighbour)).status).toBe(200); // underscore is literal, not LIKE wildcard
});
test('reply previews and HTTP/socket merged forwarding reject known burn source IDs',async()=>{
 const f=fixture();await conv.setBurnAfter(f.a,f.id,60);const secret='reply-burn-'+f.id;
 const m=await messages.send(null,f.id,f.a,{content:secret});await conv.setBurnAfter(f.a,f.id,0);
 const reply=await messages.send(null,f.id,f.a,{content:'reply',reply_to_id:m.id});
 expect(JSON.stringify(messages.history(f.id,f.b,{}).find(x=>x.id===reply.id).replyTo)).not.toContain(secret);
 const content=JSON.stringify({title:'merged',items:[{mid:m.id,snippet:secret}]});
 await expect(messages.send(null,f.id,f.a,{type:'merged',content})).rejects.toThrow('阅后即焚');
 const callbacks={};require('../src/realtime/handlers/message')({}, {user:{id:f.a},on:(name,fn)=>callbacks[name]=fn,once(name,fn){return this.on(name,fn);}});
 const ack=await new Promise(resolve=>callbacks.send_message({conversationId:f.id,type:'merged',content},resolve));expect(ack.success).toBe(false);expect(ack.error).toContain('阅后即焚');
 const normal=JSON.stringify({title:'normal',items:[{mid:reply.id,snippet:'reply'}]});
 expect((await messages.send(null,f.id,f.a,{type:'merged',content:normal})).type).toBe('merged');
});
test('expiry and upload lookup plans use selective indexes',()=>{
 const plans=[
  ["SELECT 1 FROM messages WHERE file_url!='' AND file_url>=? AND file_url<? AND deleted!=2 LIMIT 1",['/uploads/a.','/uploads/a/']],
  ["UPDATE conversation_events SET payload='{}' WHERE message_id=?",['probe']],
  ['DELETE FROM pinned_messages WHERE message_id=?',['probe']],
  ["UPDATE scheduled_messages SET content='' WHERE id=?",['probe']],
  ['SELECT MIN(burn_expires_at),MIN(burn_after) FROM messages WHERE burn_after>0 AND deleted=0 AND file_url>=? AND file_url<?',['/uploads/a.','/uploads/a/']],
  ['SELECT 1 FROM revoked_burn_files WHERE path=? OR (path>=? AND path<?)',['/uploads/a.png','/uploads/a.','/uploads/a/']],
 ];
 for(const [sql,args] of plans) {const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(x=>x.detail).join('; ');console.info('F14_QUERY_PLAN',plan);expect(plan).not.toMatch(/SCAN (messages|conversation_events|pinned_messages|scheduled_messages|revoked_burn_files)\b/);expect(plan).toMatch(/SEARCH/);}
});
