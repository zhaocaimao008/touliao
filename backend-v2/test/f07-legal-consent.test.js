'use strict';
const { app, request } = require('./f02-inprocess-http.cjs');
const { db } = require('../src/db/connection');
const bcrypt = require('bcryptjs');
const consent = require('./legal-consent.cjs');
const { version } = require('../src/modules/legal/documents');
const credentials = { phone: '13007000001', password: 'Testpass123' };
beforeAll(() => db.prepare('INSERT INTO users(id,username,phone,password,wechat_id) VALUES (?,?,?,?,?)').run('f07-user','f07-user',credentials.phone,bcrypt.hashSync(credentials.password,4),'f07-user'));
afterAll(async () => { await require('../src/db/writer').shutdown(); });
test.each(['privacy','terms'])('%s is publicly readable and versioned', async kind => {
  const r = await request(app).get(`/api/legal/${kind}`);
  expect(r.status).toBe(200); expect(r.body.version).toBe(version); expect(r.body.text.length).toBeGreaterThan(300);
});
test.each([undefined, { ...consent, accepted: false }, { ...consent, privacyVersion: 'old' }])('login rejects absent, false or stale consent', async legalConsent => {
  const r = await request(app).post('/api/auth/login').send({ ...credentials, legalConsent });
  expect(r.status).toBe(400); expect(r.body.error_code).toBe('LEGAL_CONSENT_REQUIRED');
  expect(db.prepare('SELECT COUNT(*) n FROM auth_sessions WHERE user_id=?').get('f07-user').n).toBe(0);
});
test('registration rejects before creating an account', async () => {
  const r = await request(app).post('/api/auth/register').send({ username: 'f07-new', phone: '13007000002', password: 'Testpass123', inviteCode: '123456' });
  expect(r.status).toBe(400); expect(r.body.error_code).toBe('LEGAL_CONSENT_REQUIRED');
  expect(db.prepare('SELECT id FROM users WHERE phone=?').get('13007000002')).toBeUndefined();
});
test('accepted login persists the exact versions and server time', async () => {
  const r = await request(app).post('/api/auth/login').send({ ...credentials, legalConsent: consent });
  expect(r.status).toBe(200);
  const row = db.prepare('SELECT * FROM legal_consents WHERE user_id=?').get('f07-user');
  expect(row).toMatchObject({ privacy_version: consent.privacyVersion, terms_version: consent.termsVersion });
  expect(row.accepted_at).toBeGreaterThan(0);
});
test('accepted registration persists consent; failed registration cannot leave a partial consent', async () => {
  const body = { username:'f07-accepted',phone:'13007000003',password:'Testpass123',inviteCode:'123456',legalConsent:consent };
  const r = await request(app).post('/api/auth/register').send(body);
  expect(r.status).toBe(200);
  expect(db.prepare('SELECT privacy_version,terms_version FROM legal_consents WHERE user_id=?').get(r.body.user.id)).toEqual({privacy_version:version,terms_version:version});
  expect((await request(app).post('/api/auth/register').send(body)).status).toBe(400);
  expect(db.prepare('SELECT COUNT(*) n FROM legal_consents WHERE user_id=?').get(r.body.user.id).n).toBe(1);
});
test('consent storage failure rolls back registration and login cannot issue a session', async () => {
  db.exec("CREATE TRIGGER f07_fail_consent BEFORE INSERT ON legal_consents BEGIN SELECT RAISE(ABORT,'synthetic consent storage failure'); END");
  try {
    const r = await request(app).post('/api/auth/register').send({username:'f07-rollback',phone:'13007000004',password:'Testpass123',inviteCode:'123456',legalConsent:consent});
    expect(r.status).toBe(500); expect(db.prepare('SELECT id FROM users WHERE phone=?').get('13007000004')).toBeUndefined();
    const before = db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n;
    expect((await request(app).post('/api/auth/login').send({...credentials,legalConsent:consent})).status).toBe(500);
    expect(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n).toBe(before);
  } finally { db.exec('DROP TRIGGER f07_fail_consent'); }
});
test('bundled native and public policy text matches the versioned server text', () => {
  const fs=require('fs'),path=require('path'),docs=require('../src/modules/legal/documents');
  for (const file of ['ios/Touliao/Features/Safety/LegalDocuments.swift','android/app/src/main/java/com/touliao/app/feature/safety/LegalDocuments.kt']) {
    const text=fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
    expect(text).toContain(docs.version);expect(text).toContain(docs.privacy);expect(text).toContain(docs.terms);
  }
  for (const kind of ['privacy','terms']) expect(fs.readFileSync(path.resolve(__dirname,`../../web/public/${kind}.html`),'utf8')).toContain(docs[kind]);
});

test('legacy wallet switching requires current recorded consent', async () => {
  const r = await request(app).post('/api/auth/login').send({...credentials,legalConsent:consent});
  expect(r.status).toBe(200);
  const cookie=(r.headers['set-cookie'] || []).find(c=>c.startsWith('vxin_wallet=')).split(';')[0];
  const switchRequest=()=>request(app).post('/api/auth/switch').set('Cookie',cookie).send({userId:'f07-user'});
  expect((await switchRequest()).status).toBe(200);
  db.prepare('DELETE FROM legal_consents WHERE user_id=?').run('f07-user');
  const rejected=await switchRequest();expect(rejected.status).toBe(400);expect(rejected.body.error_code).toBe('LEGAL_CONSENT_REQUIRED');
});

test.each([
  undefined, {...consent,accepted:false}, {...consent,accepted:'true'},
  {...consent,privacyVersion:'old'}, {...consent,termsVersion:undefined},
])('registration consent rejection leaves users and consents unchanged: %j',async legalConsent=>{
  const before=db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const records=db.prepare('SELECT COUNT(*) n FROM legal_consents').get().n;
  const r=await request(app).post('/api/auth/register').send({username:'matrix',phone:'13007000009',password:'Testpass123',inviteCode:'123456',legalConsent});
  expect(r.status).toBe(400);expect(r.body.error_code).toBe('LEGAL_CONSENT_REQUIRED');
  expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(before);
  expect(db.prepare('SELECT COUNT(*) n FROM legal_consents').get().n).toBe(records);
});
test('old recorded consent is not silently upgraded; explicit current login enables wallet switching and preserves history',async()=>{
  db.prepare('DELETE FROM legal_consents WHERE user_id=?').run('f07-user');
  db.prepare('INSERT INTO legal_consents(user_id,privacy_version,terms_version,accepted_at) VALUES (?,?,?,?)').run('f07-user','2026-09-20','2026-09-20',100);
  const old={accepted:true,privacyVersion:'2026-09-20',termsVersion:'2026-09-20'};
  const sessions=db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n;
  expect((await request(app).post('/api/auth/login').send({...credentials,legalConsent:old})).status).toBe(400);
  expect(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n).toBe(sessions);
  const r=await request(app).post('/api/auth/login').send({...credentials,legalConsent:consent});
  expect(r.status).toBe(200);
  const records=()=>db.prepare('SELECT privacy_version,terms_version,accepted_at FROM legal_consents WHERE user_id=? ORDER BY accepted_at').all('f07-user');
  const accepted=records();expect(accepted).toHaveLength(2);
  expect(accepted[0]).toEqual({privacy_version:'2026-09-20',terms_version:'2026-09-20',accepted_at:100});
  expect(accepted[1]).toMatchObject({privacy_version:version,terms_version:version});
  const cookie=r.headers['set-cookie'].find(c=>c.startsWith('vxin_wallet=')).split(';')[0];
  expect((await request(app).post('/api/auth/switch').set('Cookie',cookie).send({userId:'f07-user'})).status).toBe(200);
  expect((await request(app).post('/api/auth/login').send({...credentials,legalConsent:consent})).status).toBe(200);
  expect(records()).toEqual(accepted);
});
test('public HTML entry points serve full text, reject stale versions and unknown documents',async()=>{
  for(const kind of ['privacy','terms']) {
    const r=await request(app).get(`/api/legal/${kind}?format=html`);
    expect(r.status).toBe(200);expect(r.headers['content-type']).toContain('text/html');
    expect(r.text).toContain(require('../src/modules/legal/documents')[kind]);
    expect((await request(app).get(`/api/legal/${kind}?version=1999`)).status).toBe(409);
  }
  expect((await request(app).get('/api/legal/missing')).status).toBe(404);
  const landing=require('fs').readFileSync(require('path').resolve(__dirname,'../../landing/lib/content.ts'),'utf8');
  for(const kind of ['privacy','terms']) expect(landing).toContain(`/api/legal/${kind}?format=html`);
});
