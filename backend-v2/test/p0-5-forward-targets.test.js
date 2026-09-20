const {db,fixture,messages}=require('./batch2-fixture.cjs');
afterAll(async()=>require('../src/db/writer').shutdown());
test('each source × target has an honest durable result and retry preserves it',async()=>{
 const f=fixture();const muted=fixture();
 db.prepare("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES (?,?,'member')").run(muted.id,f.a);
 db.prepare('UPDATE conversations SET mute_all=1 WHERE id=?').run(muted.id);
 const m=await messages.send(null,f.id,f.a,{content:'forward synthetic'});
 const body={msgIds:[m.id],conversationIds:[f.id,muted.id,'not-a-member'],client_batch_id:require('crypto').randomUUID()};
 const r=await messages.forward(null,f.a,body);
 expect(r.status).toBe('partial_success');
 expect(r.target_results).toHaveLength(3);
 expect(r.target_results.filter(x=>x.status==='success')).toHaveLength(1);
 expect(r.retryable_message_ids).toEqual([]);
 expect(await messages.forward(null,f.a,body)).toEqual(r);
});
test('HTTP wrapper marks partial operation as unsuccessful and concurrent retry cannot double-send',async()=>{
 const f=fixture();const m=await messages.send(null,f.id,f.a,{content:'concurrent-forward'});
 const body={msgIds:[m.id],conversationIds:[f.id,'denied'],client_batch_id:require('crypto').randomUUID()};
 const [first,retry]=await Promise.all([messages.forward(null,f.a,body),messages.forward(null,f.a,body)]);
 expect(first.status).toBe('partial_success');expect(['processing','partial_success']).toContain(retry.status);
 const {app,request}=require('./f02-inprocess-http.cjs');
 const token=require('jsonwebtoken').sign({id:f.a,csrf:'synthetic'},require('../src/config').jwtSecret,{expiresIn:'1h'});
 const response=await request(app).post('/api/messages/forward').set('Authorization',`Bearer ${token}`).send(body);
 expect(response.body).toMatchObject({success:false,status:'partial_success',target_success_count:1,target_failed_count:1});
 expect(db.prepare('SELECT * FROM messages WHERE batch_id=?').all(first.batch_id)).toHaveLength(1);
});
test.each(['success','processing'])('old %s batch without target cells omits unavailable target counts',async status=>{
 const f=fixture(),clientId=require('crypto').randomUUID();
 db.prepare('INSERT INTO message_forward_batches(batch_id,actor_id,client_batch_id,status,total,success_count,failed_count) VALUES (?,?,?,?,?,?,?)').run(clientId,f.a,clientId,status,2,1,1);
 const result=await messages.forward(null,f.a,{msgIds:['old'],conversationIds:[f.id],client_batch_id:clientId});
 expect(result).toMatchObject({status,success_count:1,failed_count:1});expect(result).not.toHaveProperty('target_success_count');expect(result).not.toHaveProperty('target_failed_count');
});
