'use strict';
const http = require('http');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const setupRealtime = require('../src/realtime');
let server, io, url;
const sockets=[];
const auth=(req,u)=>req.set('Authorization','Bearer '+u.token);
const wait=(socket,predicate=()=>true)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off('social_state_changed',on);reject(new Error('missing social invalidation'));},1000);
  function on(data){if(predicate(data)){clearTimeout(timer);socket.off('social_state_changed',on);resolve(data);}}
  socket.on('social_state_changed',on);
});
async function connect(u) {
 const s=client(url,{transports:['websocket'],auth:{token:u.token},reconnection:false});sockets.push(s);
 await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;
}
beforeAll(async()=>{
 server=http.createServer(app);io=new Server(server,{transports:['websocket']});app.set('io',io);setupRealtime(io,app);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;
});
afterAll(async()=>{for(const s of sockets)s.close();await new Promise(r=>io.close(r));await new Promise(r=>server.close(r));});
test('SOCIAL-008: two devices invalidate private remark; reconnect reads truth; legacy body preserved',async()=>{
 const a=await makeUser(),b=await makeUser();await befriend(a,b);
 const a1=await connect(a),a2=await connect(a);
 const notice1=wait(a1),notice2=wait(a2);
 const [changed,e1,e2]=await Promise.all([
  auth(request(app).put('/api/users/contacts/'+b.userId+'/remark'),a).send({remark:'private note'}),
  notice1,notice2]);
 expect(changed.status).toBe(200);expect(changed.body).toEqual({success:true});
 expect(e1).toMatchObject({userId:a.userId});expect(e2).toMatchObject({userId:a.userId});
 expect(JSON.stringify(e1)).not.toContain('private note');
 a2.disconnect();
 await auth(request(app).put('/api/users/contacts/'+b.userId+'/remark'),a).send({remark:'latest note'});
 await connect(a); // Offline recovery uses authoritative HTTP, not replaying stale event values.
 const read=await auth(request(app).get('/api/users/contacts'),a);
 expect(read.body.find(x=>x.id===b.userId).remark).toBe('latest note');
 expect(read.headers['cache-control']).toContain('no-store');
});
test('profile/relationship/preference mutations invalidate observers, failed writes do not',async()=>{
 const a=await makeUser(),b=await makeUser();await befriend(a,b);const conv=await privateConversation(a,b);
 const sa=await connect(a),sb=await connect(b);
 let event=wait(sb);await Promise.all([auth(request(app).put('/api/users/profile'),a).send({bio:'synthetic bio'}),event]);
 event=wait(sa);
 const [muted]=await Promise.all([auth(request(app).post('/api/messages/conversation/'+conv+'/mute'),a).send({muted:true}),event]);
 expect(muted.status).toBe(200);expect(muted.body).toEqual({success:true});
 const pair=[wait(sa),wait(sb)];
 const [deleted]=await Promise.all([auth(request(app).delete('/api/users/contacts/'+b.userId),a),...pair]);
 expect(deleted.body).toEqual({success:true});
 const events=[];sa.on('social_state_changed',x=>events.push(x));
 const failed=await auth(request(app).put('/api/users/contacts/'+b.userId+'/remark'),a).send({remark:'not a contact'});
 expect(failed.status).toBe(404);await new Promise(r=>setTimeout(r,50));expect(events).toEqual([]);
});

test('real Socket.IO call is revoked on HTTP blacklist mutation and legacy request cannot ring again', async () => {
 const a=await makeUser(),b=await makeUser();await befriend(a,b);await privateConversation(a,b);
 const sa=await connect(a),sb=await connect(b);
 const incoming=new Promise(resolve=>sb.once('call:incoming',resolve));
 sa.emit('call:request',{to:b.userId,type:'audio'});
 const invitation=await incoming;
 const ended=new Promise(resolve=>sb.once('call:end',resolve));
 const blocked=await auth(request(app).post('/api/users/block/'+b.userId),a).send({});
 expect(blocked.status).toBe(200);
 expect(await ended).toMatchObject({callId:invitation.callId,reason:'permission_revoked'});
 const calls=[];sb.on('call:incoming',x=>calls.push(x));
 const denied=new Promise(resolve=>sa.once('call:response',resolve));
 sa.emit('call:request',{to:b.userId,type:'audio'}); // released-client payload: no new fields required
 expect(await denied).toMatchObject({accepted:false,code:'CONTACT_BLOCKED'});
 expect(calls).toEqual([]);
});

test('SOCIAL-011: removed body cannot return through live edit, quoted broadcast or duplicate ACK', async () => {
 const a=await makeUser(),b=await makeUser();await befriend(a,b);const conv=await privateConversation(a,b);
 const sa=await connect(a),sb=await connect(b);
 const packet={conversationId:conv,content:'SYNTHETIC_SOCKET_SECRET',type:'text',clientMsgId:require('crypto').randomUUID()};
 const send=()=>new Promise(resolve=>sa.emit('send_message',packet,resolve));
 const sent=await send();expect(sent.success).toBe(true);const mid=sent.message.id;
 await auth(request(app).delete('/api/messages/'+mid),b).send({forMe:true});
 const changed=[];sb.on('message_edited',x=>changed.push(x));
 await auth(request(app).put('/api/messages/'+mid+'/edit'),a).send({content:'SYNTHETIC_EDITED_SECRET'});
 await new Promise(r=>setTimeout(r,30));expect(changed).toEqual([]);
 const quoted=new Promise(resolve=>sb.once('new_message',resolve));
 await auth(request(app).post('/api/messages/'+conv),a).send({type:'text',content:'allowed reply',reply_to_id:mid});
 expect((await quoted).replyTo).toBeNull();
 await auth(request(app).delete('/api/messages/'+mid),a).send({forMe:true});
 const retry=await send();expect(retry.success).toBe(true);expect(retry.message.content).toBe('');expect(retry.message.deleted).toBe(2);
});
