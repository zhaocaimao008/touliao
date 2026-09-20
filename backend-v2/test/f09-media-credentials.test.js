'use strict';
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { app, request, makeUser } = require('./f02-inprocess-http.cjs');
const config = require('../src/config');
const { registerFile } = require('../src/utils/fileRegistry');
let owner, other, file;
beforeAll(async () => {
  owner = await makeUser({ username: 'f09-owner' });
  other = await makeUser({ username: 'f09-other' });
  file = '/uploads/files/f09.txt';
  fs.mkdirSync(path.join(config.uploadsRoot, 'files'), { recursive: true });
  fs.writeFileSync(path.join(config.uploadsRoot, 'files/f09.txt'), 'synthetic bytes');
  const { db } = require('../src/db/connection');
  db.prepare('INSERT INTO conversations(id,type) VALUES (?,?)').run('f09-conv','group');
  db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES (?,?)').run('f09-conv',owner.userId);
  db.prepare('INSERT INTO messages(id,conversation_id,sender_id,type,content,file_url) VALUES (?,?,?,?,?,?)').run('f09-msg','f09-conv',owner.userId,'file','synthetic',file);
  registerFile({ path: file, ownerId: owner.userId, conversationId: 'f09-conv', kind: 'files' });
});
afterAll(async () => { await require('../src/db/writer').shutdown(); });
test('login JWT query is rejected; authenticated header is allowed', async () => {
  expect((await request(app).get(file).set('Authorization', `Bearer ${owner.token}`)).status).toBe(200);
  const rejected = await request(app).get(`${file}?token=${owner.token}`);
  expect(rejected.status).toBe(401); expect(rejected.body.code).toBe('MEDIA_CLIENT_UPGRADE_REQUIRED');
});
test('ticket is short lived, single resource and cannot authenticate API', async () => {
  const r = await request(app).get(`/api/uploads/ticket?file=${file}`).set('Authorization', `Bearer ${owner.token}`);
  expect(r.status).toBe(200);
  const token = new URL(r.body.url, 'https://fixture.invalid').searchParams.get('token');
  const payload = jwt.decode(token);
  expect(payload.purpose).toBe('upload-read');
  expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
  expect((await request(app).get(r.body.url)).status).toBe(200);
  expect((await request(app).get(`/uploads/files/another.txt?token=${token}`)).status).toBe(401);
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  expect((await request(app).get(`/api/uploads/ticket?file=${file}`).set('Authorization', `Bearer ${other.token}`)).status).toBe(403);
  const expired = jwt.sign({ ...payload, exp: Math.floor(Date.now()/1000)-1 }, config.jwtSecret);
  expect((await request(app).get(`${file}?token=${expired}`)).status).toBe(401);
});
test('query ticket cannot be used for writes and forged long-lived tickets are refused', async () => {
  const r = await request(app).get(`/api/uploads/ticket?file=${file}`).set('Authorization', `Bearer ${owner.token}`);
  expect((await request(app).post(r.body.url).send({})).status).toBe(401);
  const p = jwt.decode(new URL(r.body.url, 'https://fixture.invalid').searchParams.get('token'));
  const token = jwt.sign({ ...p, exp: p.iat + 604800 }, config.jwtSecret);
  expect((await request(app).get(`${file}?token=${token}`)).status).toBe(401);
});

test('empty, duplicate and alternate query credentials cannot fall back to Bearer', async () => {
  for (const query of ['token=', `token=a&token=${owner.token}`, 'access_token=', `access_token=${owner.token}`]) {
    expect((await request(app).get(`${file}?${query}`).set('Authorization', `Bearer ${owner.token}`)).status).toBe(401);
  }
});
test('ticket supports HEAD and Range; expired playback can obtain a new ticket', async () => {
  const issue = () => request(app).get(`/api/uploads/ticket?file=${file}`).set('Authorization', `Bearer ${owner.token}`);
  const r = await issue(); expect(r.headers['cache-control']).toBe('no-store');
  const head = await request(app).head(r.body.url);
  expect(head.status).toBe(200); expect(head.text).toBe(''); expect(Number(head.headers['content-length'])).toBe(15);
  const range = await request(app).get(r.body.url).set('Range', 'bytes=0-8');
  expect(range.status).toBe(206); expect(range.text).toBe('synthetic'); expect(range.headers['content-range']).toBe('bytes 0-8/15');
  const payload = jwt.decode(new URL(r.body.url, 'https://fixture.invalid').searchParams.get('token'));
  const expired = jwt.sign({ ...payload, exp: Math.floor(Date.now()/1000)-1 }, config.jwtSecret);
  expect((await request(app).get(`${file}?token=${expired}`).set('Range', 'bytes=0-8')).status).toBe(401);
  const fresh = await issue(); expect((await request(app).get(fresh.body.url)).status).toBe(200);
  expect((await request(app).get(`/api/uploads/ticket?file=${file}`).set('Authorization', `Bearer ${new URL(fresh.body.url, 'https://fixture.invalid').searchParams.get('token')}`)).status).toBe(401);
});
test('revoked credential invalidates concurrent ticket replays and further issuance', async () => {
  const r = await request(app).get(`/api/uploads/ticket?file=${file}`).set('Authorization', `Bearer ${owner.token}`);
  expect((await request(app).get(r.body.url)).status).toBe(200);
  await require('../src/utils/tokenBlacklist').addToBlacklist(owner.token, jwt.decode(owner.token).exp);
  const results = await Promise.all(Array.from({ length: 4 }, () => request(app).get(r.body.url)));
  expect(results.map(r => r.status)).toEqual([401, 401, 401, 401]);
  expect((await request(app).get(`/api/uploads/ticket?file=${file}`).set('Authorization', `Bearer ${owner.token}`)).status).toBe(401);
});
