'use strict';
const { app, request, makeUser } = require('./f02-inprocess-http.cjs');
const { db } = require('../src/db/connection');
const svc = require('../src/modules/conversations/conversations.service');
const { isMember } = require('../src/modules/messages/shared');
let owner, admin, member, outsider, serial = 0;
beforeAll(async () => { [owner, admin, member, outsider] = await Promise.all(['owner', 'admin', 'member', 'outsider'].map(role => makeUser({ username: `f03-${role}` }))); });
afterAll(async () => { await require('../src/db/writer').shutdown(); });
function fixture(type = 'group') {
  const id = `f03-${++serial}`;
  db.prepare('INSERT INTO conversations(id,type) VALUES (?,?)').run(id, type);
  for (const [u, role] of [[owner, 'owner'], [admin, 'admin'], [member, 'member']]) db.prepare('INSERT INTO conversation_members(conversation_id,user_id,role) VALUES (?,?,?)').run(id, u.userId, role);
  db.prepare('INSERT INTO messages(id,conversation_id,sender_id,type,content,file_url) VALUES (?,?,?,?,?,?)').run(`${id}-msg`, id, owner.userId, 'file', 'synthetic group history', '/uploads/files/f03.txt');
  return id;
}
const clear = (id, user) => request(app).delete(`/api/messages/conversation/${id}/messages`).set('Authorization', `Bearer ${user.token}`);
const message = id => db.prepare('SELECT content,file_url,deleted FROM messages WHERE id=?').get(`${id}-msg`);
test('ordinary member is denied and everyone else retains the original body', async () => {
  const id = fixture();
  const before = message(id);
  const result = await clear(id, member);
  expect({ status: result.status, message: message(id) }).toEqual({ status: 403, message: before });
});
test.each(['owner', 'admin'])('%s can clear and the operation is durably audited', async role => {
  const id = fixture();
  const user = role === 'owner' ? owner : admin;
  expect((await clear(id, user)).status).toBe(200);
  expect(message(id)).toEqual({ content: '', file_url: '', deleted: 2 });
  const audit = db.prepare("SELECT user_id,details FROM audit_logs WHERE resource_id=? AND action='clear_conversation'").get(id);
  expect(audit?.user_id).toBe(user.userId);
  expect(JSON.parse(audit.details)).toMatchObject({ role, deleted: 1 });
});
test('nonmember and recently demoted admin are denied without trusting cached membership', async () => {
  const id = fixture();
  isMember(id, admin.userId);
  db.prepare('UPDATE conversation_members SET role=? WHERE conversation_id=? AND user_id=?').run('member', id, admin.userId);
  expect((await clear(id, admin)).status).toBe(403);
  expect((await clear(id, outsider)).status).toBe(403);
  expect(message(id).content).toBe('synthetic group history');
});
test('parallel denied requests and retries cannot erase history', async () => {
  const id = fixture();
  const results = await Promise.all(Array.from({ length: 6 }, () => clear(id, member)));
  expect(results.map(r => r.status)).toEqual(Array(6).fill(403));
  expect(message(id).deleted).toBe(0);
});
test('audit write failure rolls the destructive operation back', () => {
  const id = fixture();
  db.exec("CREATE TRIGGER f03_audit_fail BEFORE INSERT ON audit_logs WHEN NEW.action='clear_conversation' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END");
  try {
    expect(() => svc.clearConversation(null, owner.userId, id)).toThrow('synthetic audit failure');
    expect(message(id).content).toBe('synthetic group history');
    expect(db.prepare('SELECT 1 FROM conversation_clears WHERE conversation_id=?').get(id)).toBeUndefined();
  } finally { db.exec('DROP TRIGGER f03_audit_fail'); }
});
test('existing private bidirectional clear and personal clear-all remain available', async () => {
  const id = fixture('private');
  expect((await clear(id, member)).status).toBe(200);
  expect(message(id).deleted).toBe(2);
  const group = fixture();
  svc.clearAllConversations(null, member.userId);
  expect(message(group).deleted).toBe(0);
  expect(db.prepare('SELECT cleared_rowid FROM conversation_clears WHERE conversation_id=? AND user_id=?').get(group, member.userId).cleared_rowid).toBeGreaterThan(0);
});
