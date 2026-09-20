'use strict';
jest.mock('../src/utils/push', () => ({ pushNewMessage: () => Promise.resolve() }));
jest.mock('../src/utils/cloudStorage', () => ({
  ...jest.requireActual('../src/utils/cloudStorage'),
  getPublicBase: () => 'https://cdn.fixture.invalid',
}));
const fs = require('fs');
const path = require('path');
const { app, request, makeUser } = require('./f02-inprocess-http.cjs');
const { db } = require('../src/db/connection');
const config = require('../src/config');
const { registerFile, fileShareOp } = require('../src/utils/fileRegistry');
const svc = require('../src/modules/messages/messages.service');
const registerHandler = require('../src/realtime/handlers/file');
const presence = require('../src/realtime/presence');
let a, b, c, serial = 0;
beforeAll(async () => {
  [a, b, c] = await Promise.all(['a', 'b', 'c'].map(n => makeUser({ username: `f02-${n}` })));
  fs.mkdirSync(path.join(config.uploadsRoot, 'files'), { recursive: true });
});
afterAll(async () => { await new Promise(resolve => setImmediate(resolve)); await require('../src/db/writer').shutdown(); });
function fixture() {
  const prefix = `f02-${++serial}`;
  const source = `${prefix}-source`, planted = `${prefix}-planted`, target = `${prefix}-target`;
  for (const [id, users] of [[source, [a, b]], [planted, [c]], [target, [a, b, c]]]) {
    db.prepare('INSERT INTO conversations(id,type) VALUES (?,?)').run(id, 'group');
    for (const u of users) db.prepare('INSERT INTO conversation_members(conversation_id,user_id,role) VALUES (?,?,?)').run(id, u.userId, 'member');
  }
  const url = `/uploads/files/${prefix}.txt`;
  fs.writeFileSync(path.join(config.uploadsRoot, 'files', `${prefix}.txt`), 'synthetic attachment');
  registerFile({ path: url, ownerId: a.userId, conversationId: source, kind: 'files' });
  const insert = (id, conv, sender) => db.prepare('INSERT INTO messages(id,conversation_id,sender_id,type,content,file_url) VALUES (?,?,?,?,?,?)').run(id, conv, sender, 'file', 'synthetic file', url);
  insert(`${prefix}-original`, source, a.userId);
  // Simulate a historical planted row; it must not become proof of attachment ownership.
  insert(`${prefix}-forged`, planted, c.userId);
  return { prefix, source, planted, target, url, original: `${prefix}-original`, forged: `${prefix}-forged` };
}
const download = (f, user) => request(app).get(f.url).set('Authorization', `Bearer ${user.token}`);
const shares = f => db.prepare('SELECT * FROM file_registry_shares WHERE path=?').all(f.url);
async function send(f, user, conv = f.planted) {
  let handler;
  const socket = { user: { id: user.userId }, on: (event, fn) => { if (event === 'send_file_message') handler = fn; } };
  const io = { to: () => ({ emit() {} }) };
  registerHandler(io, socket);
  // Avoid testing unrelated per-second message quotas.
  const rate = jest.spyOn(presence, 'checkMsgRate').mockReturnValue({ ok: true });
  try { return await new Promise(resolve => handler({ conversationId: conv, type: 'file', file_url: f.url }, resolve)); }
  finally { rate.mockRestore(); }
}
test('unrelated account: download denied -> Socket planting denied -> no share grant', async () => {
  const f = fixture();
  expect((await download(f, c)).status).toBe(403);
  const result = await send(f, c);
  expect(result.success).toBe(false);
  expect(shares(f)).toHaveLength(0);
  expect((await download(f, c)).status).toBe(403);
});
test('historical planted message cannot be forwarded into a download authorization', async () => {
  const f = fixture();
  expect((await download(f, c)).status).toBe(403);
  const result = await svc.forward(null, c.userId, { msgId: f.forged, conversationIds: [f.target] });
  expect({ status: result.status, shares: shares(f), download: (await download(f, c)).status }).toEqual({ status: 'failed', shares: [], download: 403 });
  expect(result.retryable_message_ids).toEqual([]);
});
test.each(['source', 'attachment', 'target'])('missing source stays retryable alongside a %s permission denial, including batch replay', async denial => {
  const f = fixture();
  const user = denial === 'target' ? a : c;
  const deniedId = denial === 'attachment' ? f.forged : f.original;
  const missingId = `${f.prefix}-missing`;
  const input = { msgIds: [deniedId, missingId], conversationIds: [denial === 'target' ? f.planted : f.target],
    client_batch_id: `${f.prefix}-mixed-denial` };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await svc.forward(null, user.userId, input);
    expect(result).toMatchObject({ status: 'failed', total: 2, success_count: 0, failed_count: 2,
      retryable_message_ids: [missingId] });
    expect(result.failed_message_ids.sort()).toEqual([deniedId, missingId].sort());
    expect(shares(f)).toHaveLength(0);
  }
});
test('unsupported source type retains the existing non-permission retry hint', async () => {
  const f = fixture();
  db.prepare('UPDATE messages SET type=? WHERE id=?').run('red_packet', f.original);
  const result = await svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] });
  expect(result).toMatchObject({ status: 'failed', failed_message_ids: [f.original], retryable_message_ids: [f.original] });
  expect(shares(f)).toHaveLength(0);
});
test.each(['owner', 'original-member'])('%s may send and forward to another conversation', async role => {
  const f = fixture();
  const user = role === 'owner' ? a : b;
  expect((await send(f, user, f.source)).success).toBe(true);
  expect((await download(f, c)).status).toBe(403);
  expect((await svc.forward(null, user.userId, { msgId: f.original, conversationIds: [f.target] })).status).toBe('success');
  // Both the authorized Socket send and forward now commit their grants atomically.
  expect(shares(f).map(s => s.conversation_id).sort()).toEqual([f.source, f.target].sort());
  expect((await download(f, c)).status).toBe(200);
});
test('removed original member cannot plant or forward using a historical URL', async () => {
  const f = fixture();
  db.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?').run(f.source, b.userId);
  db.prepare('INSERT INTO messages(id,conversation_id,sender_id,type,content,file_url) VALUES (?,?,?,?,?,?)').run(`${f.prefix}-removed`, f.target, b.userId, 'file', '', f.url);
  expect((await send(f, b, f.target)).success).toBe(false);
  expect((await svc.forward(null, b.userId, { msgId: `${f.prefix}-removed`, conversationIds: [f.target] })).status).toBe('failed');
  expect(shares(f)).toHaveLength(0);
});
test('failed message write cannot leave a share; same operation can retry after rollback', async () => {
  const f = fixture();
  db.exec(`CREATE TRIGGER f02_message_fail BEFORE INSERT ON messages WHEN NEW.conversation_id='${f.target}' BEGIN SELECT RAISE(ABORT, 'synthetic message failure'); END`);
  try {
    const result = await svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] });
    expect(result.status).toBe('failed');
    expect(result.retryable_message_ids).toEqual([f.original]);
    expect(shares(f)).toHaveLength(0);
    expect((await download(f, c)).status).toBe(403);
  } finally { db.exec('DROP TRIGGER f02_message_fail'); }
  expect((await svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] })).status).toBe('success');
  expect(shares(f)).toHaveLength(1);
});

test.each(['stickers', 'avatars'])('recipient can send and forward public %s without original membership', async category => {
  const f = fixture();
  f.url = `/uploads/${category}/${f.prefix}.png`;
  fs.mkdirSync(path.join(config.uploadsRoot, category), { recursive: true });
  fs.writeFileSync(path.join(config.uploadsRoot, category, `${f.prefix}.png`), 'synthetic public media');
  registerFile({ path: f.url, ownerId: a.userId, kind: category });
  db.prepare('UPDATE messages SET type=?,file_url=? WHERE id=?').run('image', f.url, f.forged);
  expect((await download(f, c)).status).toBe(200);
  expect((await request(app).get(f.url)).status).toBe(401);
  expect((await send(f, c)).success).toBe(true);
  const result = await svc.forward(null, c.userId, { msgId: f.forged, conversationIds: [f.target] });
  expect(result.status).toBe('success');
  expect(db.prepare('SELECT file_url FROM messages WHERE conversation_id=?').get(f.target).file_url).toBe(f.url);
  // Public media still cannot bypass destination membership at commit time.
  const op = fileShareOp(f.url, f.source, c.userId);
  expect(() => db.transaction(() => db.prepare(op.sql).run(...op.params))()).toThrow(/NOT NULL/);
});

test('private moments media: owner can forward, planted reference cannot delegate visibility', async () => {
  const f = fixture();
  f.url = `/uploads/moments/${f.prefix}.png`;
  fs.mkdirSync(path.join(config.uploadsRoot, 'moments'), { recursive: true });
  fs.writeFileSync(path.join(config.uploadsRoot, 'moments', `${f.prefix}.png`), 'synthetic private moment');
  registerFile({ path: f.url, ownerId: a.userId, kind: 'moments' });
  db.prepare('INSERT INTO moments(id,user_id,content,images,visibility) VALUES (?,?,?,?,?)')
    .run(f.prefix, a.userId, 'private', JSON.stringify([f.url]), 'private');
  db.prepare('UPDATE messages SET type=?,file_url=? WHERE id IN (?,?)').run('image', f.url, f.original, f.forged);
  expect((await download(f, a)).status).toBe(200);
  expect((await download(f, c)).status).toBe(403);
  expect((await svc.forward(null, c.userId, { msgId: f.forged, conversationIds: [f.target] })).retryable_message_ids).toEqual([]);
  expect(shares(f)).toHaveLength(0);
  expect((await svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] })).status).toBe('success');
  expect((await download(f, c)).status).toBe(403); // A chat share must not expose a private moment.
});

test('second forward is allowed for original members but read-only recipients cannot mint another share', async () => {
  const f = fixture();
  expect((await svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] })).status).toBe('success');
  const forwarded = db.prepare('SELECT id FROM messages WHERE conversation_id=?').get(f.target).id;
  expect((await download(f, c)).status).toBe(200);
  const result = await svc.forward(null, c.userId, { msgId: forwarded, conversationIds: [f.planted] });
  expect(result).toMatchObject({ status: 'failed', failed_message_ids: [forwarded], retryable_message_ids: [] });
  expect((await send(f, c)).success).toBe(false);
  expect(shares(f).map(s => s.conversation_id)).toEqual([f.target]);
  expect((await svc.forward(null, b.userId, { msgId: forwarded, conversationIds: [f.source] })).status).toBe('success');
});

test('CDN references require registered authority: registered owner allowed, stranger and unregistered denied', async () => {
  const f = fixture();
  f.url = `https://cdn.fixture.invalid/uploads/files/${f.prefix}.png`;
  db.prepare('UPDATE messages SET file_url=? WHERE id IN (?,?)').run(f.url, f.original, f.forged);
  expect((await send(f, a, f.target)).success).toBe(false);
  expect((await svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] })).status).toBe('failed');
  registerFile({ path: f.url, ownerId: a.userId, conversationId: f.source, kind: 'files' });
  expect((await send(f, c)).success).toBe(false);
  expect((await svc.forward(null, c.userId, { msgId: f.forged, conversationIds: [f.target] })).retryable_message_ids).toEqual([]);
  expect(shares(f)).toHaveLength(0);
  expect((await send(f, a, f.target)).success).toBe(true);
  expect((await svc.forward(null, b.userId, { msgId: f.original, conversationIds: [f.target] })).status).toBe('success');
});

test('public category aliases cannot bypass private-file authority', async () => {
  const f = fixture();
  for (const url of [`/uploads/stickers/../files/${f.prefix}.txt`, `/uploads/avatars/%2e%2e%2ffiles%2f${f.prefix}.txt`, `${f.url}?category=stickers`, f.url.toUpperCase()]) {
    expect((await send({ ...f, url }, c)).success).toBe(false);
  }
  expect(shares(f)).toHaveLength(0);
});

test('thumbnail, rejected login query URL and download ticket enforce the same private-file boundary', async () => {
  const f = fixture();
  const thumb = `/uploads/files/${f.prefix}_thumb.webp`;
  fs.writeFileSync(path.join(config.uploadsRoot, 'files', `${f.prefix}_thumb.webp`), 'synthetic thumbnail');
  registerFile({ path: thumb, ownerId: a.userId, conversationId: f.source, kind: 'files' });
  for (const url of [f.url, thumb]) {
    expect((await request(app).get(`${url}?token=${c.token}`)).status).toBe(401);
    expect((await request(app).get(`${url}?token=${b.token}`)).status).toBe(401);
    const ticket = async user => request(app).get(`/api/uploads/ticket?file=${encodeURIComponent(url)}`).set('Authorization', `Bearer ${user.token}`);
    const denied = await ticket(c);
    expect(denied.status).toBe(403);
    const allowed = await ticket(b);
    expect(allowed.status).toBe(200);
    expect((await request(app).get(allowed.body.url)).status).toBe(200);
    expect((await send({ ...f, url }, c)).success).toBe(false);
  }
  expect(shares(f)).toHaveLength(0);
});

test('collecting a private URL as a sticker cannot bypass the HTTP file-message entry', async () => {
  const f = fixture();
  const collect = await request(app).post('/api/stickers/collect').set('Authorization', `Bearer ${c.token}`).send({ url: f.url });
  expect(collect.status).toBe(200); // Ownership of a saved bookmark is not ownership of its bytes.
  const before = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(f.planted).n;
  const sent = await request(app).post('/api/stickers/send').set('Authorization', `Bearer ${c.token}`)
    .send({ stickerId: collect.body.id, conversationId: f.planted });
  expect(sent.status).toBe(403);
  expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(f.planted).n).toBe(before);
  expect(shares(f)).toHaveLength(0);
  expect((await download(f, c)).status).toBe(403);
});

test.each(['private-owner', 'public-recipient'])('HTTP sticker send permits %s and commits its reference atomically', async role => {
  const f = fixture();
  const user = role === 'private-owner' ? a : c;
  if (role === 'public-recipient') f.url = `/uploads/stickers/${f.prefix}.png`;
  const collected = await request(app).post('/api/stickers/collect').set('Authorization', `Bearer ${user.token}`).send({ url: f.url });
  expect(collected.status).toBe(200);
  const sent = await request(app).post('/api/stickers/send').set('Authorization', `Bearer ${user.token}`)
    .send({ stickerId: collected.body.id, conversationId: f.target });
  expect(sent.status).toBe(200);
  expect(sent.body.file_url).toBe(f.url);
  expect(shares(f).map(s => s.conversation_id)).toEqual([f.target]);
  if (role === 'private-owner') expect((await download(f, c)).status).toBe(200);
});
test('parallel permitted forwarding is atomic and share uniqueness survives retries', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 4 }, () => svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] })));
  expect(results.map(r => r.status)).toEqual(Array(4).fill('success'));
  expect(shares(f)).toHaveLength(1);
  expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(f.target).n).toBe(4);
});
test.each(['forward', 'upload'])('%s sync-event failure rolls back both the message and its grant', async entry => {
  const f = fixture();
  db.exec(`CREATE TRIGGER f02_event_fail BEFORE INSERT ON conversation_events WHEN NEW.conversation_id='${f.target}' BEGIN SELECT RAISE(ABORT, 'synthetic event failure'); END`);
  try {
    if (entry === 'forward') {
      expect((await svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] })).status).toBe('failed');
    } else {
      await expect(svc.saveUploadedFile(null, f.target, a.userId, { type: 'file', content: 'synthetic', fileUrl: f.url }))
        .rejects.toThrow('synthetic event failure');
    }
    expect(shares(f)).toHaveLength(0);
    expect(db.prepare('SELECT 1 FROM messages WHERE conversation_id=?').get(f.target)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM conversation_sequences WHERE conversation_id=?').get(f.target)).toBeUndefined();
  } finally { db.exec('DROP TRIGGER f02_event_fail'); }
});
test.each(['original', 'destination'])('membership revoked in %s conversation before queued grant commits is rejected', kind => {
  const f = fixture();
  const op = fileShareOp(f.url, f.target, b.userId);
  db.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?').run(kind === 'original' ? f.source : f.target, b.userId);
  expect(() => db.transaction(() => db.prepare(op.sql).run(...op.params))()).toThrow(/NOT NULL/);
  expect(shares(f)).toHaveLength(0);
});
