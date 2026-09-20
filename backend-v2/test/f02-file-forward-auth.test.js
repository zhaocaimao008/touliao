'use strict';
jest.mock('../src/utils/push', () => ({ pushNewMessage: () => Promise.resolve() }));
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
    expect(shares(f)).toHaveLength(0);
    expect((await download(f, c)).status).toBe(403);
  } finally { db.exec('DROP TRIGGER f02_message_fail'); }
  expect((await svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] })).status).toBe('success');
  expect(shares(f)).toHaveLength(1);
});
test('parallel permitted forwarding is atomic and share uniqueness survives retries', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 4 }, () => svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] })));
  expect(results.map(r => r.status)).toEqual(Array(4).fill('success'));
  expect(shares(f)).toHaveLength(1);
  expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(f.target).n).toBe(4);
});
test('sync-event failure rolls back both the message and its grant', async () => {
  const f = fixture();
  db.exec(`CREATE TRIGGER f02_event_fail BEFORE INSERT ON conversation_events WHEN NEW.conversation_id='${f.target}' BEGIN SELECT RAISE(ABORT, 'synthetic event failure'); END`);
  try {
    expect((await svc.forward(null, a.userId, { msgId: f.original, conversationIds: [f.target] })).status).toBe('failed');
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
