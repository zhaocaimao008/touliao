'use strict';

const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const config = require('../src/config');
const setupRealtime = require('../src/realtime');
const authService = require('../src/modules/auth/auth.service');
const messages = require('../src/modules/messages/messages.service');
const conversations = require('../src/modules/conversations/conversations.service');
const { syncConversation } = require('../src/modules/messages/sync.service');

let server, io, base, a, b, c, conversationId;
const auth = u => `Bearer ${u.token}`;
const sockets = new Set();
function connect(token, headers = {}) {
  return new Promise((resolve, reject) => {
    const s = client(base, { transports: ['websocket'], auth: { token }, extraHeaders: headers, reconnection: false });
    sockets.add(s);
    const timer = setTimeout(() => { s.close(); reject(new Error('handshake timeout')); }, 2000);
    s.once('connect', () => { clearTimeout(timer); resolve(s); });
    s.once('connect_error', err => { clearTimeout(timer); s.close(); reject(err); });
  });
}

beforeAll(async () => {
  [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  await befriend(a, b);
  conversationId = await privateConversation(a, b);
  server = http.createServer(app);
  io = new Server(server, { transports: ['websocket'] });
  app.set('io', io);
  setupRealtime(io, app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise(resolve => io.close(resolve));
  await new Promise(resolve => server.close(resolve));
});

test('session ownership: an outsider cannot revoke another user JWT', async () => {
  const victimJti = jwt.decode(c.token).jti;
  const res = await request(app).delete(`/api/auth/sessions/${victimJti}`).set('Authorization', auth(a));
  expect(res.status).toBe(404);
  expect((await request(app).get('/api/auth/me').set('Authorization', auth(c))).status).toBe(200);
});

test('refresh returns a usable Bearer token', async () => {
  const res = await request(app).post('/api/auth/refresh').set('Authorization', auth(a));
  expect(res.status).toBe(200);
  expect(typeof res.body.token).toBe('string');
  a.token = res.body.token;
  expect((await request(app).get('/api/auth/me').set('Authorization', auth(a))).status).toBe(200);
});

test('cleared and individually deleted content never reappears in sync', async () => {
  const m = await messages.send(null, conversationId, a.userId, { content: 'private-before-clear', type: 'text' });
  await request(app).delete(`/api/messages/conversation/${conversationId}/messages`).set('Authorization', auth(a)).expect(200);
  expect(JSON.stringify(syncConversation(conversationId, a.userId))).not.toContain('private-before-clear');
  expect(JSON.stringify(syncConversation(conversationId, b.userId, { cursor: 0 }))).toContain('private-before-clear');
  await messages.remove(null, b.userId, m.id, false, false, true);
  expect(JSON.stringify(syncConversation(conversationId, b.userId))).not.toContain('private-before-clear');
});

test('recalled content is redacted from historical edit payloads, including paginated sync', async () => {
  const start = syncConversation(conversationId, a.userId).next_cursor;
  const m = await messages.send(null, conversationId, a.userId, { content: 'before-recall', type: 'text' });
  await messages.edit(null, a.userId, m.id, 'edited-secret-recalled');
  await messages.remove(null, a.userId, m.id, true, false, false);
  let cursor = start;
  for (let n = 0; n < 4; n++) {
    const page = syncConversation(conversationId, b.userId, { cursor, limit: 1 });
    expect(JSON.stringify(page)).not.toContain('edited-secret-recalled');
    cursor = page.next_cursor;
    if (!page.has_more) return;
  }
  throw new Error('sync cursor failed to complete');
});

test('read receipts follow insertion order, retain same-second unread, and never regress', async () => {
  const id = 'audit-read-order';
  db.prepare("INSERT INTO conversations (id,type) VALUES (?,'private')").run(id);
  for (const u of [a,b]) db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(id,u.userId);
  const ids = ['z-old', 'm-read', 'a-new'];
  for (const messageId of ids) db.prepare("INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,'text',?,?)").run(messageId,id,a.userId,messageId,1800000000);
  db.prepare('INSERT INTO conversation_settings (user_id,conversation_id,last_read_at,last_read_message_id) VALUES (?,?,?,?)').run(b.userId,id,0,ids[1]);
  await conversations.markRead(null, b.userId, id, ids[1]);
  const receipts = db.prepare('SELECT message_id FROM message_reads WHERE user_id=? AND message_id IN (?,?,?)').all(b.userId,...ids).map(r=>r.message_id);
  expect(receipts.sort()).toEqual(ids.slice(0,2).sort());
  await conversations.markRead(null, b.userId, id, ids[0]);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(db.prepare('SELECT last_read_message_id FROM conversation_settings WHERE user_id=? AND conversation_id=?').get(b.userId,id).last_read_message_id).toBe(ids[1]);
  await expect(conversations.markRead(null, b.userId, id, 'foreign-message')).rejects.toMatchObject({ status: 400 });
});

test('logout disconnects an idle socket before any further private broadcast', async () => {
  const u = await makeUser();
  const s = await connect(u.token);
  const disconnected = new Promise(resolve => s.once('disconnect', resolve));
  await request(app).post('/api/auth/logout').set('Authorization', auth(u)).expect(200);
  await Promise.race([disconnected, new Promise((_,reject)=>setTimeout(()=>reject(new Error('idle socket survived logout')),1000))]);
  expect(s.connected).toBe(false);
});

test('malformed percent-encoded Cookie is rejected promptly without unhandled rejection', async () => {
  await expect(connect(b.token, { Cookie: 'vxin_token=%E0%A4%A' })).rejects.not.toThrow('handshake timeout');
});

test('expired idle sockets disconnect without requiring an outgoing event', async () => {
  const payload = jwt.decode(b.token);
  const token = jwt.sign({id:b.userId,username:b.username,jti:payload.jti},config.jwtSecret,{expiresIn:1});
  const s = await connect(token);
  await Promise.race([new Promise(resolve=>s.once('disconnect',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('expired socket still connected')),1800))]);
  expect(s.connected).toBe(false);
});

test('terminate other sessions keeps the current token valid and revokes all other wallet grants', async () => {
  const u = await makeUser();
  const login = await request(app).post('/api/auth/login').set('User-Agent','iPhone like Mac OS X').send({phone:u.phone,password:u.password});
  const other = login.body.token;
  authService.recordDeviceAccount('audit-old-wallet',u.userId);
  await new Promise(resolve=>setTimeout(resolve,1100));
  await request(app).delete('/api/auth/sessions').set('Authorization',auth(u)).expect(200);
  expect((await request(app).get('/api/auth/me').set('Authorization',auth(u))).status).toBe(200);
  expect((await request(app).get('/api/auth/me').set('Authorization',`Bearer ${other}`)).status).toBe(401);
  expect(() => authService.switchAccount('audit-old-wallet',u.userId,{headers:{}})).toThrow();
});

test('iPhone and iPad are classified before Mac OS compatibility tokens', () => {
  expect(authService.detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)').platform).toBe('iPhone');
  expect(authService.detectDevice('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)').platform).toBe('iPad');
});


test('revoking one session disconnects only its idle socket', async () => {
  const u=await makeUser();
  const login=await request(app).post('/api/auth/login').set('User-Agent','iPhone like Mac OS X').send({phone:u.phone,password:u.password}).expect(200);
  const current=await connect(u.token),other=await connect(login.body.token);
  const disconnected=new Promise(resolve=>other.once('disconnect',resolve));
  await request(app).delete(`/api/auth/sessions/${jwt.decode(login.body.token).jti}`).set('Authorization',auth(u)).expect(200);
  await disconnected;expect(other.connected).toBe(false);expect(current.connected).toBe(true);
  current.close();
});

test('password change disconnects idle sockets without outgoing events', async () => {
  const u=await makeUser(),s=await connect(u.token);
  const disconnected=new Promise(resolve=>s.once('disconnect',resolve));
  await authService.changePassword(u.userId,{oldPassword:u.password,newPassword:'changed12345',currentToken:u.token});
  await disconnected;expect(s.connected).toBe(false);
});

test('HTTP and Socket simultaneous retry share one persisted message', async () => {
  const s=await connect(a.token),key=require('crypto').randomUUID();
  const data={conversationId,content:'transport retry',type:'text',clientMsgId:key};
  const [socketAck,httpAck]=await Promise.all([
    new Promise(resolve=>s.emit('send_message',data,resolve)),
    request(app).post(`/api/messages/${conversationId}`).set('Authorization',auth(a)).send({content:data.content,type:data.type,client_msg_id:key}),
  ]);
  expect(socketAck.success).toBe(true);expect(httpAck.status).toBe(200);expect(socketAck.message.id).toBe(httpAck.body.id);
  expect(db.prepare('SELECT COUNT(*) n FROM conversation_events WHERE message_id=?').get(httpAck.body.id).n).toBe(1);
  s.close();
});
