'use strict';
// Enable the real limiter before importing the application (testEnv defaults it off).
process.env.DISABLE_RATE_LIMIT='0';
process.env.REDIS_URL='';
const {app,request,makeUser}=require('./f02-inprocess-http.cjs');
const {db}=require('../src/db/connection');
const config=require('../src/config'),jwt=require('jsonwebtoken');
let owner,other;
const auth=(req,user=owner)=>req.set('Authorization',`Bearer ${user.token}`);
const adminToken=()=>jwt.sign({admin:true,username:config.admin.username,csrf:'signed-admin-csrf'},config.adminJwtSecret,{expiresIn:'1h'});
const adminCookie=()=>`${config.admin.cookieName}=${adminToken()}`;
const row=id=>db.prepare('SELECT status,handled_by FROM safety_reports WHERE id=?').get(id);
const events=id=>db.prepare('SELECT status FROM safety_report_events WHERE report_id=? ORDER BY id').all(id).map(e=>e.status);
async function ticket(){const r=await auth(request(app).post('/api/reports')).send({targetType:'support',targetId:'support',reason:require('crypto').randomUUID()});expect(r.status).toBe(201);return r.body.id;}
beforeAll(async()=>{owner=await makeUser({username:'guards-owner'});other=await makeUser({username:'guards-other'});});
afterAll(async()=>{process.env.DISABLE_CSRF='1';await require('../src/db/writer').shutdown();});
test('anonymous/foreign access denied and owner allowed; forged payload cannot set identity/status/internal fields',async()=>{
  const r=await auth(request(app).post('/api/reports')).send({targetType:'support',targetId:'support',reason:'forged fields',reporter_id:other.userId,status:'resolved',handled_by:'forged'});
  expect(r.status).toBe(201);const id=r.body.id;
  expect(db.prepare('SELECT reporter_id,status,handled_by FROM safety_reports WHERE id=?').get(id)).toEqual({reporter_id:owner.userId,status:'pending',handled_by:null});
  expect((await request(app).get(`/api/reports/${id}`)).status).toBe(401);
  expect((await auth(request(app).get(`/api/reports/${id}`),other)).status).toBe(404);
  const own=await auth(request(app).get(`/api/reports/${id}`));expect(own.status).toBe(200);
  for(const key of ['snapshot','reporter_id','handled_by']) expect(own.body).not.toHaveProperty(key);
  expect(own.body.events.every(e=>!('actor' in e))).toBe(true);
  const list=await auth(request(app).get('/api/reports'),other);expect(list.status).toBe(200);expect(list.body.items.some(x=>x.id===id)).toBe(false);
});
test('ordinary bearer, user cookie and forged admin signature cannot list/read/resolve; valid admin can',async()=>{
  const id=await ticket();
  const wrong=jwt.sign({admin:true,username:config.admin.username,csrf:'x'},'synthetic-wrong-admin-signing-secret');
  for(const header of [{Authorization:`Bearer ${owner.token}`},{Cookie:`${config.admin.cookieName}=${owner.token}`},{Cookie:`${config.admin.cookieName}=${wrong}`}]) {
    for(const [method,url] of [['get','/api/admin/safety-reports'],['get',`/api/admin/safety-reports/${id}`],['post',`/api/admin/safety-reports/${id}/resolve`]]) {
      let req=request(app)[method](url);for(const [k,v] of Object.entries(header)) req=req.set(k,v);
      const r=await req.send(method==='post'?{status:'dismissed',note:'forged'}:undefined);expect(r.status).toBe(401);
      expect(row(id)).toEqual({status:'pending',handled_by:null});expect(events(id)).toEqual(['pending']);
    }
  }
  expect((await request(app).get(`/api/admin/safety-reports/${id}`).set('Cookie',adminCookie())).status).toBe(200);
});
test('CSRF is bound to signed admin session: missing/mismatched/forged pair/Bearer bypass refused, valid token advances once with audit',async()=>{
  const id=await ticket();process.env.DISABLE_CSRF='0';
  try {
    const resolve=()=>request(app).post(`/api/admin/safety-reports/${id}/resolve`);
    for(const extra of [ {}, {'X-CSRF-Token':'wrong'}, {'Cookie':`${adminCookie()}; ${config.csrfCookie}=forged`,'X-CSRF-Token':'forged'}, {'Authorization':`Bearer ${owner.token}`} ]) {
      let req=resolve().set('Cookie',adminCookie());for(const [k,v] of Object.entries(extra))req=req.set(k,v);
      expect((await req.send({status:'reviewing',note:'synthetic'})).status).toBe(403);
      expect(row(id).status).toBe('pending');expect(events(id)).toEqual(['pending']);
    }
    const accept=()=>resolve().set('Cookie',`${adminCookie()}; ${config.csrfCookie}=signed-admin-csrf`).set('X-CSRF-Token','signed-admin-csrf');
    expect((await accept().send({status:'reviewing',note:'synthetic accepted'})).status).toBe(200);
    expect(row(id)).toEqual({status:'reviewing',handled_by:config.admin.username});expect(events(id)).toEqual(['pending','reviewing']);
    expect((await accept().send({status:'reviewing',note:'duplicate'})).status).toBe(409);
    expect((await accept().send({status:'dismissed',note:'synthetic dismissed'})).status).toBe(200);
    expect((await accept().send({status:'resolved',note:'terminal'})).status).toBe(409);
    expect(events(id)).toEqual(['pending','reviewing','dismissed']);
    const audit=db.prepare("SELECT details FROM audit_logs WHERE resource_id=? AND action='resolve_safety_report' ORDER BY rowid").all(id).map(x=>JSON.parse(x.details));
    expect(audit).toEqual([{status:'reviewing',adminUsername:config.admin.username},{status:'dismissed',adminUsername:config.admin.username}]);
  } finally {process.env.DISABLE_CSRF='1';}
});
test('real reactLimiter permits first 30, refuses 31st without writing, and does not consume another user quota',async()=>{
  const limited=await makeUser({username:'guards-limited'});
  const send=(user,n)=>auth(request(app).post('/api/reports'),user).send({targetType:'support',targetId:'support',reason:`limit ${n}`});
  for(let n=0;n<30;n++)expect((await send(limited,n)).status).toBe(201);
  const before=db.prepare('SELECT COUNT(*) n FROM safety_reports').get().n;
  const r=await send(limited,30);expect(r.status).toBe(429);
  expect(db.prepare('SELECT COUNT(*) n FROM safety_reports').get().n).toBe(before);
  expect((await send(other,31)).status).toBe(201);
});
