jest.mock('../src/utils/push',()=>({pushNewMessage:jest.fn(async()=>{})}));
const { db, fixture } = require('./batch2-fixture.cjs');
const sched=require('../src/modules/messages/scheduled.service');
const {purgeConversation}=require('../src/modules/messages/shared');
afterAll(async()=>require('../src/db/writer').shutdown());
function task(f,status='pending',version=1) { const id=require('crypto').randomUUID(); db.prepare('INSERT INTO scheduled_messages(id,conversation_id,sender_id,content,send_at,status) VALUES (?,?,?,?,?,?)').run(id,f.id,f.a,'scheduled synthetic',1,status);if(db.pragma('table_info(scheduled_messages)').some(c=>c.name==='delivery_version')) db.prepare('UPDATE scheduled_messages SET delivery_version=? WHERE id=?').run(version,id);return id; }
test('dissolution removes all task states with FK enabled',()=>{
 const f=fixture(); for(const s of ['pending','sending','sent','cancelled']) task(f,s);
 expect(()=>purgeConversation(f.id)).not.toThrow();
 expect(db.prepare('SELECT * FROM scheduled_messages WHERE conversation_id=?').all(f.id)).toHaveLength(0);
 expect(db.pragma('foreign_key_check')).toEqual([]);
});
test('abandoned sending recovers and concurrent retries commit exactly one message',async()=>{
 const f=fixture();const id=task(f,'sending');
 if(db.pragma('table_info(scheduled_messages)').some(c=>c.name==='delivery_version')) db.prepare('UPDATE scheduled_messages SET delivery_version=1 WHERE id=?').run(id);
 await Promise.all([sched.sendDueMessages(),sched.sendDueMessages()]);
 expect(db.prepare('SELECT status FROM scheduled_messages WHERE id=?').get(id).status).toBe('sent');
 expect(db.prepare('SELECT * FROM messages WHERE conversation_id=?').all(f.id)).toHaveLength(1);
 await sched.sendDueMessages();
 expect(db.prepare('SELECT * FROM messages WHERE conversation_id=?').all(f.id)).toHaveLength(1);
});
test('postcommit broadcast failure must not requeue a committed delivery',async()=>{
 const f=fixture();const id=task(f); const broadcaster=require('../src/realtime/broadcaster');
 const spy=jest.spyOn(broadcaster,'broadcastMessage').mockImplementationOnce(()=>{throw Error('synthetic postcommit crash')});
 await sched.sendDueMessages();spy.mockRestore();await sched.sendDueMessages();
 expect(db.prepare('SELECT status FROM scheduled_messages WHERE id=?').get(id).status).toBe('sent');
 expect(db.prepare('SELECT * FROM messages WHERE conversation_id=?').all(f.id)).toHaveLength(1);
});

test('legacy sending without stable identity is visible for reconciliation, never blindly resent',async()=>{
 const f=fixture();const id=task(f,'sending',0);await sched.sendDueMessages();
 expect(sched.listScheduledMessages(f.a,'recovery_required').map(x=>x.id)).toContain(id);
 expect(db.prepare('SELECT * FROM messages WHERE conversation_id=?').all(f.id)).toHaveLength(0);
});

test.each(['before','after'])('real process exit %s commit recovers from durable state',async stage=>{
 const f=fixture();const id=task(f);
 const svcPath=require.resolve('../src/modules/messages/scheduled.service');
 const script=stage==='before'
  ? `const sync=require(${JSON.stringify(require.resolve('../src/modules/messages/sync.service'))});const run=sync.appendConversationEventTx;sync.appendConversationEventTx=(args)=>{run(args);process.exit(41)};require(${JSON.stringify(svcPath)}).sendDueMessages();`
  : `require(${JSON.stringify(require.resolve('../src/realtime/broadcaster'))}).broadcastMessage=()=>process.exit(42);require(${JSON.stringify(svcPath)}).sendDueMessages();`;
 const child=require('child_process').spawnSync(process.execPath,['-e',script],{cwd:'/tmp',env:process.env,timeout:10000,stdio:'inherit'});
 expect(child.error).toBeUndefined();
 expect(child.status).toBe(stage==='before'?41:42);
 expect(db.prepare('SELECT status FROM scheduled_messages WHERE id=?').get(id).status).toBe(stage==='before'?'pending':'sent');
 await sched.sendDueMessages();await sched.sendDueMessages();
 expect(db.prepare('SELECT status FROM scheduled_messages WHERE id=?').get(id).status).toBe('sent');
 expect(db.prepare('SELECT * FROM messages WHERE conversation_id=?').all(f.id)).toHaveLength(1);
});
test('dissolution winning the lock prevents a stale due list from sending',async()=>{
 const f=fixture();task(f);task(f);
 const push=require('../src/utils/push').pushNewMessage;
 push.mockImplementationOnce(async()=>{purgeConversation(f.id)});
 await sched.sendDueMessages();
 expect(db.prepare('SELECT * FROM messages WHERE conversation_id=?').all(f.id)).toHaveLength(0);
 expect(db.prepare('SELECT * FROM scheduled_messages WHERE conversation_id=?').all(f.id)).toHaveLength(0);
 expect(db.pragma('foreign_key_check')).toEqual([]);
});

test('old overdue pending is ambiguous, while never-due pending can safely adopt stable IDs',async()=>{
 const f=fixture();const overdue=task(f,'pending',0),future=task(f,'pending',0);
 db.prepare('UPDATE scheduled_messages SET send_at=? WHERE id=?').run(Math.floor(Date.now()/1000)+3600,future);
 await sched.sendDueMessages();
 expect(db.prepare('SELECT status FROM scheduled_messages WHERE id=?').get(overdue).status).toBe('recovery_required');
 expect(db.prepare('SELECT status,delivery_version FROM scheduled_messages WHERE id=?').get(future)).toEqual({status:'pending',delivery_version:1});
});
test('admin deleteUser removes all sender task states without violating foreign keys',()=>{
 const f=fixture();for(const s of ['pending','sending','sent','cancelled','recovery_required'])task(f,s);
 require('../src/modules/admin/admin.service').deleteUser(null,f.a);
 expect(db.prepare('SELECT id FROM users WHERE id=?').get(f.a)).toBeUndefined();
 expect(db.prepare('SELECT * FROM scheduled_messages WHERE sender_id=?').all(f.a)).toEqual([]);
 expect(db.pragma('foreign_key_check')).toEqual([]);
});
test('admin deleting a lone owner dissolves tasks left by a departed sender',()=>{
 const f=fixture();db.prepare('UPDATE conversations SET owner_id=? WHERE id=?').run(f.a,f.id);
 const id=task(f);db.prepare('UPDATE scheduled_messages SET sender_id=? WHERE id=?').run(f.b,id);
 db.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?').run(f.id,f.b);
 require('../src/modules/admin/admin.service').deleteUser(null,f.a);
 expect(db.prepare('SELECT id FROM conversations WHERE id=?').get(f.id)).toBeUndefined();
 expect(db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(id)).toBeUndefined();
 expect(db.pragma('foreign_key_check')).toEqual([]);
});
test('ambiguous recovery task can be cancelled only by its sender; retry never sends it',async()=>{
 const f=fixture(),id=task(f,'recovery_required',0);
 expect(()=>sched.cancelScheduledMessage(f.b,id)).toThrow('只能取消');
 expect(sched.cancelScheduledMessage(f.a,id)).toEqual({success:true});await sched.sendDueMessages();
 expect(sched.listScheduledMessages(f.a).map(x=>x.id)).not.toContain(id);
 expect(db.prepare('SELECT * FROM messages WHERE conversation_id=?').all(f.id)).toEqual([]);
});
test('two simultaneous OS processes and another retry deliver each task once',async()=>{
 const f=fixture();const ids=Array.from({length:4},()=>task(f));
 const code=`await require(${JSON.stringify(require.resolve('../src/modules/messages/scheduled.service'))}).sendDueMessages()`;
 await require('./batch2-fixture.cjs').concurrentProcesses([code,code]);await sched.sendDueMessages();
 expect(db.prepare('SELECT id FROM messages WHERE conversation_id=? ORDER BY id').all(f.id).map(m=>m.id)).toEqual(ids.map(id=>'scheduled:'+id).sort());
 expect(db.prepare("SELECT COUNT(*) AS n FROM conversation_events WHERE conversation_id=? AND event_type='message_created'").get(f.id).n).toBe(4);
});
