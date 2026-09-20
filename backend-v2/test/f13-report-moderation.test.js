'use strict';
const { app, request, makeUser } = require('./f02-inprocess-http.cjs');
const { db } = require('../src/db/connection');
let reporter, target;
beforeAll(async () => { reporter = await makeUser({ username:'f13-reporter' }); target = await makeUser({ username:'f13-target' }); });
afterAll(async () => { await require('../src/db/writer').shutdown(); });
test('authenticated user report is persisted and trackable', async () => {
  const r = await request(app).post('/api/reports').set('Authorization', `Bearer ${reporter.token}`).send({ targetType:'user', targetId:target.userId, reason:'synthetic harassment report' });
  expect(r.status).toBe(201);
  expect(db.prepare('SELECT * FROM safety_reports WHERE id=?').get(r.body.id)).toMatchObject({ status:'pending', reporter_id:reporter.userId });
  const list = await request(app).get('/api/reports').set('Authorization', `Bearer ${reporter.token}`);
  expect(list.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ id:r.body.id, status:'pending' })]));
});
test('anonymous report is rejected', async () => {
  expect((await request(app).post('/api/reports').send({targetType:'user',targetId:target.userId,reason:'synthetic'})).status).toBe(401);
});
test('missing image moderation never claims approval', async () => {
  const Moderator = require('../src/utils/contentModerator');
  expect((await new Moderator().moderateImage('synthetic-local-image')).status).not.toBe('approved');
});
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const adminCookie = () => `${config.admin.cookieName}=${jwt.sign({admin:true,username:config.admin.username,csrf:'synthetic'},config.adminJwtSecret,{expiresIn:'1h'})}`;
const asUser = (req,u=reporter)=>req.set('Authorization',`Bearer ${u.token}`);
let serial=0;
async function ticket(type='support',id='support') {
  const r = await asUser(request(app).post('/api/reports')).send({targetType:type,targetId:id,reason:`synthetic ticket ${++serial}`});
  expect(r.status).toBe(201);return r.body.id;
}
test('admin sees detail and persists pending → reviewing → resolved with actor/history; owner tracks reply',async()=>{
  const id=await ticket('user',target.userId);
  expect((await asUser(request(app).get('/api/admin/safety-reports'))).status).toBe(401);
  const list=await request(app).get('/api/admin/safety-reports?status=pending').set('Cookie',adminCookie());
  expect(list.status).toBe(200);expect(list.body.items.some(x=>x.id===id)).toBe(true);
  const detail=await request(app).get(`/api/admin/safety-reports/${id}`).set('Cookie',adminCookie());
  expect(detail.body.snapshot).toContain('f13-target');
  const resolve=(status,note='synthetic investigation')=>request(app).post(`/api/admin/safety-reports/${id}/resolve`).set('Cookie',adminCookie()).send({status,note});
  expect((await resolve('resolved')).status).toBe(409);
  expect((await resolve('reviewing','')).status).toBe(400);
  expect((await resolve('reviewing')).status).toBe(200);
  // The existing enforcement endpoint is available to the same administrator.
  expect((await request(app).post(`/api/admin/users/${target.userId}/ban`).set('Cookie',adminCookie())).status).toBe(200);
  expect(db.prepare('SELECT banned FROM users WHERE id=?').get(target.userId).banned).toBe(1);
  expect((await resolve('resolved','已核实，已封禁目标账号')).status).toBe(200);
  expect((await resolve('dismissed')).status).toBe(409);
  const own=await asUser(request(app).get(`/api/reports/${id}`));
  expect(own.body.status).toBe('resolved');expect(own.body.resolution).toBe('已核实，已封禁目标账号');
  expect(own.body.events.map(e=>e.status)).toEqual(['pending','reviewing','resolved']);expect(own.body.snapshot).toBeUndefined();
  expect(db.prepare('SELECT handled_by FROM safety_reports WHERE id=?').get(id).handled_by).toBe(config.admin.username);
  // Restore synthetic account for denial tests below.
  await request(app).post(`/api/admin/users/${target.userId}/unban`).set('Cookie',adminCookie());
});
test('foreign reporter cannot read or handle a ticket; dismissal is terminal',async()=>{
  const id=await ticket();
  expect((await asUser(request(app).get(`/api/reports/${id}`),target)).status).toBe(404);
  expect((await asUser(request(app).post(`/api/admin/safety-reports/${id}/resolve`)).send({status:'resolved',note:'forged'})).status).toBe(401);
  const r=await request(app).post(`/api/admin/safety-reports/${id}/resolve`).set('Cookie',adminCookie()).send({status:'dismissed',note:'合成样本，不成立'});
  expect(r.status).toBe(200);expect(r.body.events.map(e=>e.status)).toEqual(['pending','dismissed']);
});
test('message/group authorization is checked against current membership; burn and inaccessible messages cannot be copied into reports',async()=>{
  const cid='f13-group';
  db.prepare('INSERT INTO conversations(id,type,name) VALUES (?,?,?)').run(cid,'group','synthetic group');
  db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES (?,?)').run(cid,reporter.userId);
  db.prepare('INSERT INTO messages(id,conversation_id,sender_id,content) VALUES (?,?,?,?)').run('f13-msg',cid,target.userId,'synthetic content');
  for(const [type,id] of [['group',cid],['message','f13-msg']]) {
    const r=await asUser(request(app).post('/api/reports'),target).send({targetType:type,targetId:id,reason:'synthetic outsider'});expect(r.status).toBe(403);
    await ticket(type,id);
  }
  db.prepare('UPDATE messages SET burn_after=10 WHERE id=?').run('f13-msg');
  expect((await asUser(request(app).post('/api/reports')).send({targetType:'message',targetId:'f13-msg',reason:'burn'})).status).toBe(403);
  db.prepare('DELETE FROM conversation_members WHERE conversation_id=?').run(cid);
  expect((await asUser(request(app).post('/api/reports')).send({targetType:'group',targetId:cid,reason:'removed'})).status).toBe(403);
});
test('invalid input is rejected; identical retries reuse the durable open ticket',async()=>{
  for(const body of [{targetType:'user',targetId:reporter.userId,reason:'self'},{targetType:'support',targetId:'support',reason:''},{targetType:'sql',targetId:'x',reason:'synthetic'}]) expect((await asUser(request(app).post('/api/reports')).send(body)).status).toBe(400);
  const body={targetType:'support',targetId:'support',reason:'duplicate synthetic request'};
  const a=await asUser(request(app).post('/api/reports')).send(body),b=await asUser(request(app).post('/api/reports')).send(body);
  expect(a.body.id).toBe(b.body.id);expect(db.prepare('SELECT COUNT(*) n FROM safety_report_events WHERE report_id=?').get(a.body.id).n).toBe(1);
});
test('storage failure atomically rolls back state and trace event',async()=>{
  const id=await ticket();
  db.exec("CREATE TRIGGER f13_fail_event BEFORE INSERT ON safety_report_events BEGIN SELECT RAISE(ABORT,'synthetic event storage failure'); END");
  try {
    const r=await request(app).post(`/api/admin/safety-reports/${id}/resolve`).set('Cookie',adminCookie()).send({status:'reviewing',note:'synthetic'});
    expect(r.status).toBe(500);expect(db.prepare('SELECT status FROM safety_reports WHERE id=?').get(id).status).toBe('pending');
    const n=db.prepare('SELECT COUNT(*) n FROM safety_reports').get().n;
    expect((await asUser(request(app).post('/api/reports')).send({targetType:'support',targetId:'support',reason:'fail transaction'})).status).toBe(500);
    expect(db.prepare('SELECT COUNT(*) n FROM safety_reports').get().n).toBe(n);
  } finally { db.exec('DROP TRIGGER f13_fail_event'); }
});
test('text keyword filter rejects via real API without persisting; clean text is allowed',async()=>{
  const {privateConversation,befriend}=require('./f02-inprocess-http.cjs');
  await befriend(reporter,target);const cid=await privateConversation(reporter,target);
  const word='synthetic_f13_forbidden';
  const added=await request(app).post('/api/admin/blacklist').set('Cookie',adminCookie()).send({word});expect(added.status).toBe(200);
  const send=content=>asUser(request(app).post(`/api/messages/${cid}`)).send({type:'text',content});
  expect((await send('synthetic clean message')).status).toBe(200);
  const before=db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n;
  expect((await send(word)).status).toBe(400);expect(db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n).toBe(before);
  await request(app).delete(`/api/admin/blacklist/${added.body.id}`).set('Cookie',adminCookie());
});
test('blocking prevents private messages and hides moments; retained history is an explicit visibility boundary',async()=>{
  const {privateConversation}=require('./f02-inprocess-http.cjs');const cid=await privateConversation(reporter,target);
  const sent=await asUser(request(app).post(`/api/messages/${cid}`),target).send({type:'text',content:'synthetic before block'});expect(sent.status).toBe(200);
  const moment=await asUser(request(app).post('/api/moments'),target).send({content:'synthetic visible moment',visibility:'public'});expect(moment.status).toBe(200);
  expect((await asUser(request(app).get(`/api/moments/${moment.body.id}`))).status).toBe(200);
  expect((await asUser(request(app).post(`/api/users/block/${target.userId}`))).status).toBe(200);
  expect((await asUser(request(app).post(`/api/messages/${cid}`),target).send({type:'text',content:'synthetic after block'})).status).toBe(403);
  expect((await asUser(request(app).get(`/api/moments/${moment.body.id}`))).status).toBe(403);
  const timeline=await asUser(request(app).get('/api/moments'));
  const moments=Array.isArray(timeline.body)?timeline.body:timeline.body.items || timeline.body.moments;
  expect(moments.some(m=>m.id===moment.body.id)).toBe(false);
  const history=await asUser(request(app).get(`/api/messages/${cid}`));
  expect(history.body.some(m=>m.id===sent.body.id)).toBe(true);
  await asUser(request(app).delete(`/api/users/block/${target.userId}`));
});
test('target or reporter deletion does not erase the persisted report and its trace',async()=>{
  const tempReporter=await makeUser({username:'f13-delete-reporter'}),tempTarget=await makeUser({username:'f13-delete-target'});
  const r=await asUser(request(app).post('/api/reports'),tempReporter).send({targetType:'user',targetId:tempTarget.userId,reason:'synthetic retained report'});expect(r.status).toBe(201);
  db.prepare('DELETE FROM users WHERE id=?').run(tempTarget.userId);
  db.prepare('DELETE FROM users WHERE id=?').run(tempReporter.userId);
  const row=db.prepare('SELECT reporter_id,snapshot,status FROM safety_reports WHERE id=?').get(r.body.id);
  expect(row.reporter_id).toBeNull();expect(row.snapshot).toContain('f13-delete-target');expect(row.status).toBe('pending');
  expect(db.prepare('SELECT COUNT(*) n FROM safety_report_events WHERE report_id=?').get(r.body.id).n).toBe(1);
});
