'use strict';
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const wallet = require('../src/modules/wallet/wallet.service');
const contacts = require('../src/modules/contacts/contacts.service');
const scheduled = require('../src/modules/messages/scheduled.service');
const admin = require('../src/modules/admin/admin.service');
let a, b, conv;
const send = (amount = 7, key) => {
  const req = request(app).post('/api/wallet/transfer').set('Authorization', `Bearer ${a.token}`);
  if (key) req.set('Idempotency-Key', key);
  return req.send({ to_user_id: b.userId, amount, note: 'guard regression' });
};
const snapshot = () => ({
  balances: db.prepare('SELECT user_id,balance FROM wallets WHERE user_id IN (?,?) ORDER BY user_id').all(a.userId,b.userId),
  ledger: db.prepare('SELECT COUNT(*) n FROM wallet_transactions').get().n,
  messages: db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(conv).n,
});
beforeAll(async () => {
  a = await makeUser(); b = await makeUser(); await befriend(a,b); conv = await privateConversation(a,b);
  wallet.recharge(a.userId, 1000); wallet.ensureWallet(b.userId);
});
test('blocking either direction rejects transfer without writes; replay remains idempotent', async () => {
  const first = await send(7,'jev-transfer-allowed'); expect(first.status).toBe(200);
  for (const [from,to] of [[b,a],[a,b]]) {
    contacts.block(from.userId,to.userId); const before = snapshot();
    expect((await send()).status).toBe(403); expect(snapshot()).toEqual(before);
    const replay = await send(7,'jev-transfer-allowed');
    expect(replay.status).toBe(200); expect(replay.body.message.id).toBe(first.body.message.id); expect(snapshot()).toEqual(before);
    contacts.unblock(from.userId,to.userId);
  }
});
test('recipient stranger privacy applies to existing conversation transfers', async () => {
  db.prepare('DELETE FROM contacts WHERE user_id=? AND contact_id=?').run(b.userId,a.userId);
  db.prepare('INSERT OR IGNORE INTO user_settings(user_id) VALUES (?)').run(b.userId);
  db.prepare('UPDATE user_settings SET block_unknown_messages=1 WHERE user_id=?').run(b.userId);
  const before=snapshot(); expect((await send()).status).toBe(403); expect(snapshot()).toEqual(before);
  db.prepare('UPDATE user_settings SET block_unknown_messages=0 WHERE user_id=?').run(b.userId);
  expect((await send()).status).toBe(200);
});
test.each([1.9,'1.9','2oops','3e2',true,[2],{},null,'',-1,0,20001,Number.MAX_SAFE_INTEGER+1])('invalid transfer %j rejected unchanged', async amount => {
  const before=snapshot(); expect((await send(amount)).status).toBe(400); expect(snapshot()).toEqual(before);
});
test.each([1.9,'1.9','2oops','3e2',true,[2],{},null])('invalid recharge %j rejected', async amount => {
  const before=snapshot();
  expect((await request(app).post('/api/wallet/recharge').set('Authorization', `Bearer ${a.token}`).send({amount})).status).toBe(400);
  expect(snapshot()).toEqual(before);
});
test.each([{limit:'1.5'},{offset:'0.2'},{limit:'bad'},{limit:'2e1'},{offset:'-1'},{limit:['1','2']}])('pagination rejects %j', async query => {
  expect((await request(app).get('/api/wallet/transactions').set('Authorization', `Bearer ${a.token}`).query(query)).status).toBe(400);
});
test('wallet pagination defaults and integer strings work',async()=>{
  for(const query of [{},{limit:'2',offset:'0'},{limit:'1000'}]) expect((await request(app).get('/api/wallet/transactions').set('Authorization',`Bearer ${a.token}`).query(query)).status).toBe(200);
});
test.each([undefined,null,{},[],42,'','   ','x'.repeat(2001)])('invalid collection %# returns 400',async content=>{
  const before=db.prepare('SELECT COUNT(*) n FROM collections WHERE user_id=?').get(a.userId).n;
  expect((await request(app).post('/api/users/me/collections').set('Authorization',`Bearer ${a.token}`).send({type:'text',content})).status).toBe(400);
  expect(db.prepare('SELECT COUNT(*) n FROM collections WHERE user_id=?').get(a.userId).n).toBe(before);
});
test('banned sender task cancels permanently; new task after unban sends once',async()=>{
  const create=()=>scheduled.scheduleMessage(a.userId,{conversation_id:conv,content:'scheduled guard',send_at:Math.floor(Date.now()/1000)+3600});
  const due=id=>db.prepare('UPDATE scheduled_messages SET send_at=0 WHERE id=?').run(id);
  const old=create(); admin.setBanned(null,a.userId,true); due(old.id);
  expect(await scheduled.sendDueMessages()).toBe(0);
  expect(db.prepare('SELECT status FROM scheduled_messages WHERE id=?').get(old.id).status).toBe('cancelled');
  expect(db.prepare('SELECT id FROM messages WHERE id=?').get('scheduled:'+old.id)).toBeUndefined();
  admin.setBanned(null,a.userId,false); expect(await scheduled.sendDueMessages()).toBe(0);
  const fresh=create(); due(fresh.id); expect(await scheduled.sendDueMessages()).toBe(1); expect(await scheduled.sendDueMessages()).toBe(0);
});
