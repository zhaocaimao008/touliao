'use strict';
const { app, request, makeUser, befriend, privateConversation } = require('./f02-inprocess-http.cjs');
const { db } = require('../src/db/connection');
const wallet = require('../src/modules/wallet/wallet.service');
const broadcaster = require('../src/realtime/broadcaster');
const { fork } = require('child_process');
const path = require('path');
let a, b, c, conv;
beforeAll(async () => {
  a = await makeUser({ username: 'f06-sender' }); b = await makeUser({ username: 'f06-receiver' });
  await befriend(a, b); conv = await privateConversation(a, b);
  c = await makeUser({ username: 'f06-other-receiver' });
  await befriend(a, c); await privateConversation(a, c);
  wallet.applyDelta(a.userId, 2000, 'recharge');
  wallet.applyDelta(b.userId, 2000, 'recharge');
});
afterAll(async () => { await require('../src/db/writer').shutdown(); });
const children = new Set();
afterEach(() => {
  jest.restoreAllMocks();
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  children.clear();
});
const counts = () => Object.fromEntries(['messages', 'red_packets', 'wallet_transactions', 'conversation_events']
  .map(table => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
function expectSingleEffect(before, kind) {
  expect(counts()).toEqual({ messages: before.messages + 1, conversation_events: before.conversation_events + 1,
    wallet_transactions: before.wallet_transactions + (kind === 'transfer' ? 2 : 1),
    red_packets: before.red_packets + (kind === 'transfer' ? 0 : 1) });
}
function post(url, body, key, user = a) {
  let req = request(app).post(url).set('Authorization', `Bearer ${user.token}`);
  if (key != null) req = req.set('Idempotency-Key', key);
  return req.send(body);
}
const transfer = amount => ({ to_user_id: b.userId, amount, note: 'synthetic' });
const packet = amount => ({ conversationId: conv, totalAmount: amount, totalCount: 1, greeting: 'synthetic' });
test.each(['transfer', 'redpacket'])('%s committed with a lost response then retried concurrently only debits once', async kind => {
  const url = kind === 'transfer' ? '/api/wallet/transfer' : '/api/redpackets/send';
  const body = kind === 'transfer' ? transfer(10) : packet(10);
  const key = `f06-lost-response-${kind}`;
  const before = wallet.getBalance(a.userId);
  const rows = counts();
  const broadcast = jest.spyOn(broadcaster, 'broadcastMessage');
  const first = await post(url, body, key); // Client loses this response after the server commits.
  expect(first.status).toBe(200);
  const retries = await Promise.all(Array.from({ length: 5 }, () => post(url, body, key)));
  expect(wallet.getBalance(a.userId)).toBe(before - 10);
  expect(retries.map(r => r.body)).toEqual(Array(5).fill(first.body));
  expectSingleEffect(rows, kind);
  expect(broadcast).toHaveBeenCalledTimes(1);
  expect(broadcast).toHaveBeenCalledWith(conv, expect.objectContaining({ id: first.body.message.id }));
});
test('same key with changed payload is rejected, preserving the original result', async () => {
  const key = 'f06-payload-conflict';
  const before = wallet.getBalance(a.userId);
  expect((await post('/api/wallet/transfer', transfer(10), key)).status).toBe(200);
  expect((await post('/api/wallet/transfer', transfer(20), key)).status).toBe(409);
  expect(wallet.getBalance(a.userId)).toBe(before - 10);
});
test('same transfer key cannot be reused with another recipient', async () => {
  const key = 'f06-recipient-conflict';
  const before = wallet.getBalance(a.userId), recipientBefore = wallet.getBalance(c.userId), rows = counts();
  const first = await post('/api/wallet/transfer', transfer(2), key);
  expect(first.status).toBe(200);
  expect((await post('/api/wallet/transfer', { ...transfer(2), to_user_id: c.userId }, key)).status).toBe(409);
  expect((await post('/api/wallet/transfer', transfer(2), key)).body).toEqual(first.body);
  expect(wallet.getBalance(a.userId)).toBe(before - 2);
  expect(wallet.getBalance(c.userId)).toBe(recipientBefore);
  expectSingleEffect(rows, 'transfer');
});
test.each([{ totalAmount: 11 }, { totalCount: 2 }, { greeting: 'changed' }])('redpacket same key rejects changed payload %j', async change => {
  const key = `f06-packet-conflict-${Object.keys(change)[0]}`;
  const before = wallet.getBalance(a.userId), rows = counts();
  const first = await post('/api/redpackets/send', packet(10), key);
  expect(first.status).toBe(200);
  expect((await post('/api/redpackets/send', { ...packet(10), ...change }, key)).status).toBe(409);
  expect((await post('/api/redpackets/send', packet(10), key)).body).toEqual(first.body);
  expect(wallet.getBalance(a.userId)).toBe(before - 10);
  expectSingleEffect(rows, 'redpacket');
});
test('legacy redpacket route shares the same idempotency namespace and rejects changed conversation', async () => {
  const key = 'f06-route-alias-conflict', rows = counts(), before = wallet.getBalance(a.userId);
  const first = await post('/api/redpackets/send', packet(4), key);
  expect(first.status).toBe(200);
  const alias = await post('/api/messages/red-packet/send', packet(4), key);
  expect(alias.status).toBe(200); expect(alias.body).toEqual(first.body);
  const otherConv = await privateConversation(a, c);
  expect((await post('/api/messages/red-packet/send', { ...packet(4), conversationId: otherConv }, key)).status).toBe(409);
  expect(wallet.getBalance(a.userId)).toBe(before - 4);
  expectSingleEffect(rows, 'redpacket');
});
test('key is scoped by actor and operation; old clients without a key remain supported', async () => {
  const key = 'f06-scoped-key-01';
  expect((await post('/api/wallet/transfer', transfer(1), key)).status).toBe(200);
  expect((await post('/api/wallet/transfer', { to_user_id: a.userId, amount: 1 }, key, b)).status).toBe(200);
  expect((await post('/api/redpackets/send', packet(1), key)).status).toBe(200);
  expect((await post('/api/wallet/transfer', transfer(1), undefined)).status).toBe(200);
});
test('invalid idempotency key is rejected before any debit', async () => {
  const before = wallet.getBalance(a.userId);
  expect((await post('/api/wallet/transfer', transfer(1), 'bad key')).status).toBe(400);
  expect(wallet.getBalance(a.userId)).toBe(before);
});
test('failure after ledger writes rolls back both ledger and idempotency record; retry succeeds', async () => {
  const key = 'f06-rollback-key';
  const before = wallet.getBalance(a.userId);
  db.exec("CREATE TRIGGER f06_message_fail BEFORE INSERT ON messages WHEN NEW.type='transfer' BEGIN SELECT RAISE(ABORT, 'synthetic transaction failure'); END");
  try {
    expect((await post('/api/wallet/transfer', transfer(7), key)).status).toBe(500);
    expect(wallet.getBalance(a.userId)).toBe(before);
    expect(db.prepare('SELECT 1 FROM financial_idempotency WHERE actor_id=? AND idempotency_key=?').get(a.userId, key)).toBeUndefined();
  } finally { db.exec('DROP TRIGGER f06_message_fail'); }
  expect((await post('/api/wallet/transfer', transfer(7), key)).status).toBe(200);
  expect(wallet.getBalance(a.userId)).toBe(before - 7);
});
function processClient() {
  const child = fork(path.join(__dirname, 'fixtures/f06-financial-process.cjs'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  children.add(child);
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('message', msg => msg.ready ? resolve() : reject(new Error('fixture not ready')));
    child.once('exit', (code, signal) => reject(new Error(`fixture exited before ready: ${code}/${signal}`)));
  });
  const done = new Promise(resolve => {
    let result;
    child.on('message', msg => { if (!msg.ready) result = msg; });
    child.once('exit', (code, signal) => resolve({ code, signal, ...result }));
  });
  return { ready, done, send: input => child.send({ actorId: a.userId, payload: transfer(3), ...input }) };
}
test.each(['transfer', 'redpacket'])('two actual processes racing on one key commit exactly one %s', async kind => {
  const before = wallet.getBalance(a.userId);
  const rows = counts();
  // Serialize schema startup only; both ready processes race on the operation.
  const clients = [processClient()];
  await clients[0].ready;
  clients.push(processClient());
  await clients[1].ready;
  clients.forEach(c => c.send({ key: `f06-process-concurrent-${kind}`, mode: 'normal', kind,
    payload: kind === 'transfer' ? transfer(3) : packet(3) }));
  const results = await Promise.all(clients.map(c => c.done));
  expect(results.map(r => r.code)).toEqual([0, 0]);
  expect(results[0].result).toEqual(results[1].result);
  expect(wallet.getBalance(a.userId)).toBe(before - 3);
  expectSingleEffect(rows, kind);
});
test.each(['transfer', 'redpacket'].flatMap(kind => ['beforeCommit', 'afterCommit'].map(mode => [kind, mode])))
('%s SIGKILL %s preserves atomicity and retry after restart is safe', async (kind, mode) => {
  const before = wallet.getBalance(a.userId);
  const rows = counts();
  const payload = kind === 'transfer' ? transfer(3) : packet(3);
  const key = `f06-process-kill-${kind}-${mode}`;
  const child = processClient();
  await child.ready;
  child.send({ key, mode, kind, payload });
  expect((await child.done).signal).toBe('SIGKILL');
  expect(wallet.getBalance(a.userId)).toBe(before - (mode === 'afterCommit' ? 3 : 0));
  const saved = db.prepare('SELECT response_json FROM financial_idempotency WHERE actor_id=? AND idempotency_key=?').get(a.userId, key);
  expect(!!saved).toBe(mode === 'afterCommit');
  if (mode === 'beforeCommit') expect(counts()).toEqual(rows);
  else expectSingleEffect(rows, kind);
  const retry = await post(kind === 'transfer' ? '/api/wallet/transfer' : '/api/redpackets/send', payload, key);
  expect(retry.status).toBe(200);
  if (saved) expect(retry.body).toEqual({ success: true, ...JSON.parse(saved.response_json) });
  expect(wallet.getBalance(a.userId)).toBe(before - 3);
  expectSingleEffect(rows, kind);
});
test('standalone migration is idempotent and matches the startup migration', () => {
  const Database = require('better-sqlite3');
  const memory = new Database(':memory:');
  try {
    memory.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    const sql = require('fs').readFileSync(path.join(__dirname, '../src/db/migrations/f06-financial-idempotency.sql'), 'utf8');
    memory.exec(sql); memory.exec(sql);
    expect(memory.prepare('PRAGMA table_info(financial_idempotency)').all()).toEqual(db.prepare('PRAGMA table_info(financial_idempotency)').all());
    expect(memory.prepare('PRAGMA foreign_key_list(financial_idempotency)').all()).toEqual(db.prepare('PRAGMA foreign_key_list(financial_idempotency)').all());
  } finally { memory.close(); }
});
