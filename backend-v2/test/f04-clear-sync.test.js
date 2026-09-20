const { db, fixture, messages, conv, sync, io } = require('./batch2-fixture.cjs');
afterAll(async () => require('../src/db/writer').shutdown());
test('personal clear converges offline cursor and cursor zero without affecting other members', async () => {
 const f=fixture(); const m=await messages.send(null,f.id,f.a,{content:'private-clear-secret'});
 const socket=io(); conv.clearAllConversations(socket,f.b);
 const page=sync.syncConversation(f.id,f.b,{cursor:m.server_sequence});
 expect(page.messages.map(e=>e.event_type)).toContain('conversation_cleared');
 expect(JSON.stringify(sync.syncConversation(f.id,f.b,{cursor:0}))).not.toContain('private-clear-secret');
 expect(messages.history(f.id,f.b,{})).toHaveLength(0);
 expect(messages.history(f.id,f.a,{}).map(x=>x.id)).toContain(m.id);
 expect(socket.events.some(e=>e.room===`user_${f.b}` && e.name==='conversation_messages_cleared')).toBe(true);
 const later=await messages.send(null,f.id,f.a,{content:'after-clear'});
 expect(messages.history(f.id,f.b,{}).map(x=>x.id)).toEqual([later.id]);
});
test('global clear durable event is atomic with role gate and audit; edit payload is redacted', async () => {
 const f=fixture(); const m=await messages.send(null,f.id,f.a,{content:'global-secret'});
 await messages.edit(null,f.a,m.id,'edited-global-secret');
 const cursor=sync.syncConversation(f.id,f.b,{}).next_cursor;
 expect(()=>conv.clearConversation(null,f.b,f.id)).toThrow();
 conv.clearConversation(null,f.a,f.id);
 expect(sync.syncConversation(f.id,f.b,{cursor}).messages.map(e=>e.event_type)).toContain('conversation_cleared');
 expect(JSON.stringify(sync.syncConversation(f.id,f.b,{}))).not.toContain('edited-global-secret');
});
test('personal deletion never leaks historical edit payload on full sync',async()=>{
 const f=fixture();const m=await messages.send(null,f.id,f.a,{content:'personal-secret'});
 await messages.edit(null,f.a,m.id,'personal-edit-secret');
 await messages.remove(null,f.b,m.id,false,false,true);
 expect(JSON.stringify(sync.syncConversation(f.id,f.b,{}))).not.toContain('personal-edit-secret');
 expect(JSON.stringify(sync.syncConversation(f.id,f.a,{}))).toContain('personal-edit-secret');
});
test('failed clear event insert rolls back bodies, watermark and audit',async()=>{
 const f=fixture();const m=await messages.send(null,f.id,f.a,{content:'atomic-secret'});
 db.exec("CREATE TRIGGER f04_event_fail BEFORE INSERT ON conversation_events WHEN NEW.event_type='conversation_cleared' BEGIN SELECT RAISE(ABORT,'synthetic clear failure'); END");
 try {
  expect(()=>conv.clearConversation(null,f.a,f.id)).toThrow('synthetic clear failure');
  expect(messages.history(f.id,f.a,{}).map(x=>x.id)).toContain(m.id);
  expect(db.prepare('SELECT * FROM conversation_clears WHERE conversation_id=?').all(f.id)).toHaveLength(0);
 }finally{db.exec('DROP TRIGGER f04_event_fail')}
});
test('clear racing an enqueued send preserves every committed postclear message',async()=>{
 const f=fixture();await messages.send(null,f.id,f.a,{content:'old'});
 const sending=messages.send(null,f.id,f.a,{content:'racing'});
 conv.clearAllConversations(null,f.b);
 const m=await sending;const page=sync.syncConversation(f.id,f.b,{});
 const clear=page.messages.find(e=>e.event_type==='conversation_cleared');
 const created=page.messages.find(e=>e.message_id===m.id);
 expect(created.message.deleted).toBe(m.server_sequence<clear.server_sequence?2:0);
 const paged=[];let cursor=0,more=true;
 while(more){const p=sync.syncConversation(f.id,f.b,{cursor,limit:1});paged.push(...p.messages);cursor=p.next_cursor;more=p.has_more}
 expect(paged).toEqual(page.messages);
});
