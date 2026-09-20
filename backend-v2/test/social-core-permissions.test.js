'use strict';
const { randomUUID } = require('crypto');
const { db } = require('../src/db/connection');
const users = require('../src/modules/users/users.service');
const contacts = require('../src/modules/contacts/contacts.service');
const groups = require('../src/modules/groups/groups.service');
const conversations = require('../src/modules/conversations/conversations.service');
const moments = require('../src/modules/moments/moments.service');
const registerCall = require('../src/realtime/handlers/call');
const createRegistry = require('../src/realtime/callSessionRegistry');
function user() {
  const id = randomUUID();
  db.prepare('INSERT INTO users(id,username,phone,password,wechat_id,bio,cover_photo) VALUES(?,?,?,?,?,?,?)')
    .run(id, 'social-'+id.slice(0,8), id, 'synthetic-fixture', 't'+id.slice(0,8), 'private signature', '/synthetic-cover');
  users.ensureSettings(id);
  return id;
}
function friends(a,b) { for (const [x,y] of [[a,b],[b,a]]) db.prepare('INSERT OR IGNORE INTO contacts(id,user_id,contact_id) VALUES(?,?,?)').run(randomUUID(),x,y); }
function group(a,b) { friends(a,b);return conversations.createGroup(null,a,{name:'synthetic group',memberIds:[b]}).conversationId; }
function transport() {
  const events=[];
  const io={to:room=>({emit:(event,payload)=>events.push({room,event,payload})}),in:()=>({socketsJoin(){},socketsLeave(){}})};
  const socket=id=>({id:randomUUID(),user:{id},handlers:{},on(event,fn){this.handlers[event]=fn;return this;},emit:(event,payload)=>events.push({event,payload}),to:io.to,broadcast:io});
  return {events,io,socket};
}
describe('SOCIAL-002 profiles respect current authorization on every read',()=>{
  test('group stranger is redacted while self and friend keep hidden bio',async()=>{
    const owner=user(),a=user(),b=user(),g=group(owner,a);friends(owner,b);groups.invite(null,g,owner,[b]);
    users.updateSettings(a,{profileVisible:false});
    expect((await users.getUserDetail(b,a)).bio).toBe('');
    expect(groups.info(g,b).members.find(x=>x.id===a).bio).toBe('');
    expect(groups.info(g,owner).members.find(x=>x.id===a).bio).toBe('private signature');
    expect((await users.getUserDetail(a,a)).bio).toBe('private signature');
  });
  test('warm profile cache cannot retain access after unfriend or block',async()=>{
    const a=user(),b=user();friends(a,b);users.updateSettings(a,{profileVisible:false});
    expect((await users.getUserDetail(b,a)).bio).toBe('private signature');
    contacts.block(a,b);
    expect((await users.getUserDetail(b,a)).bio).toBe('');
    expect(contacts.listContacts(b).find(x=>x.id===a).bio).toBe('');
    contacts.unblock(a,b);
    expect((await users.getUserDetail(b,a)).bio).toBe('private signature');
    contacts.deleteContact(a,b);
    expect((await users.getUserDetail(b,a)).cover_photo).toBe('');
  });
  test('search and QR preview never add private fields',()=>{
    const a=user(),b=user();users.updateSettings(a,{profileVisible:false});
    const name=db.prepare('SELECT username FROM users WHERE id=?').get(a).username;
    for(const row of users.search(b,name)) {expect(row).not.toHaveProperty('bio');expect(row).not.toHaveProperty('phone');}
    const scanned=users.scanQrUser(b,users.qrPayload(a));
    expect(scanned.user).not.toHaveProperty('bio');expect(scanned.user).not.toHaveProperty('phone');
  });
});
describe('SOCIAL-003/007 relation writes',()=>{
  test.each([false,true])('direct invitation and creation cannot bypass either blacklist direction: %s',reverse=>{
    const a=user(),b=user(),c=user(),g=group(a,c);friends(a,b);contacts.block(reverse?a:b,reverse?b:a);
    groups.invite(null,g,a,[b,b]);
    expect(db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(g,b)).toBeUndefined();
    const other=conversations.createGroup(null,a,{name:'synthetic group',memberIds:[b,c]}).conversationId;
    expect(db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(other,b)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(other,c)).toBeTruthy();
  });
  test('legal invitation remains idempotent and returns legacy added/blocked shape',()=>{
    const a=user(),b=user(),c=user(),g=group(a,c);friends(a,b);
    expect(groups.invite(null,g,a,[b,b])).toMatchObject({added:1,blocked:0});
    expect(groups.invite(null,g,a,[b])).toMatchObject({added:0,blocked:0});
  });
  test('disabled requester cannot be accepted; rejection still works',()=>{
    const a=user(),b=user(),req=contacts.sendFriendRequest(null,a,{toId:b});
    db.prepare('UPDATE users SET banned=1 WHERE id=?').run(a);
    expect(()=>contacts.handleRequest(null,b,req.id,'accept')).toThrow();
    expect(db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(b,a)).toBeUndefined();
    expect(()=>contacts.handleRequest(null,b,req.id,'reject')).not.toThrow();
    expect(()=>contacts.handleRequest(null,b,req.id,'reject')).not.toThrow();
  });
  test('blacklist after request rejects acceptance; existing legal friends in restricted group remain allowed',()=>{
    const a=user(),b=user(),req=contacts.sendFriendRequest(null,a,{toId:b});contacts.block(a,b);
    expect(()=>contacts.handleRequest(null,b,req.id,'accept')).toThrow();
    contacts.unblock(a,b);contacts.handleRequest(null,b,req.id,'accept');
    const g=group(a,b);groups.manage(null,g,a,{no_private_chat:true});
    expect(conversations.getOrCreatePrivate(a,b).conversationId).toBeTruthy();
    const c=user();expect(()=>conversations.getOrCreatePrivate(c,a)).toThrow();
  });
});
describe('SOCIAL-010 notification authorization and counts',()=>{
  function scenario() {
    const a=user(),b=user(),c=user();friends(a,b);friends(a,c);
    const m=moments.createMoment(null,a,{content:'restricted moment',images:[],visibility:'friends'});
    moments.addComment(null,b,m.id,{content:'first'});
    moments.addComment(null,c,m.id,{content:'restricted reply',replyToUser:b});
    return {a,b,c,m};
  }
  test.each(['private','unfriend','block','age','exclude'])('notification no longer reveals content or count after %s',change=>{
    const {a,b,m}=scenario();
    expect(moments.unreadNotificationCount(b)).toBe(1);
    if(change==='private')moments.editMoment(a,m.id,{visibility:'private'});
    if(change==='exclude')moments.editMoment(a,m.id,{visibility:'exclude',visibleTo:[b]});
    if(change==='unfriend')contacts.deleteContact(a,b);
    if(change==='block')contacts.block(a,b);
    if(change==='age'){db.prepare('UPDATE moments SET created_at=? WHERE id=?').run(1,m.id);users.updateSettings(a,{momentsVisibleDays:1});}
    expect(()=>moments.getMoment(b,m.id)).toThrow();
    const feed=moments.listNotifications(b,{limit:1});
    expect(feed.items).toEqual([]);expect(feed.total).toBe(0);
    expect(moments.unreadNotificationCount(b)).toBe(0);
  });
  test('authorized feed keeps legacy fields and read is idempotent',()=>{
    const {b}=scenario();const feed=moments.listNotifications(b,{});
    expect(feed.items[0]).toMatchObject({moment:{content:'restricted moment'},commentContent:'restricted reply',read:false});
    moments.markNotificationsRead(b);moments.markNotificationsRead(b);expect(moments.unreadNotificationCount(b)).toBe(0);
  });
});
describe('SOCIAL-004 actual signaling handler relationship gates',()=>{
  test.each(['caller-block','callee-block','unknown'])('request does not ring after %s',reason=>{
    const a=user(),b=user();friends(a,b);conversations.getOrCreatePrivate(a,b);
    if(reason==='caller-block')contacts.block(a,b);
    if(reason==='callee-block')contacts.block(b,a);
    if(reason==='unknown'){contacts.deleteContact(a,b);users.updateSettings(b,{blockUnknownMessages:true});}
    const t=transport(),registry=createRegistry(),s=t.socket(a);registerCall(t.io,s,registry);
    s.handlers['call:request']({to:b,type:'audio'},()=>{});
    const incoming=t.events.find(e=>e.event==='call:incoming');
    if(incoming)s.handlers['call:end']({to:b,callId:incoming.payload.callId,reason:'hangup'});
    registry.reset();
    expect(incoming).toBeUndefined();
  });
  test('request allowed, then blacklist before accept rejects stale operation',()=>{
    const a=user(),b=user();friends(a,b);conversations.getOrCreatePrivate(a,b);
    const t=transport(),registry=createRegistry(),sa=t.socket(a),sb=t.socket(b);registerCall(t.io,sa,registry);registerCall(t.io,sb,registry);
    sa.handlers['call:request']({to:b,type:'audio'},()=>{});
    const incoming=t.events.find(e=>e.event==='call:incoming');expect(incoming).toBeTruthy();
    contacts.block(a,b);
    sb.handlers['call:response']({to:a,accepted:true,callId:incoming.payload.callId},()=>{});
    const session=registry.get(incoming.payload.callId);
    sa.handlers['call:end']({to:b,callId:incoming.payload.callId,reason:'hangup'});registry.reset();
    expect(session).toBeUndefined();
  });
});
