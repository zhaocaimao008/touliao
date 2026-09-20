'use strict';
const { app, request, makeUser, befriend, privateConversation } = require('./f02-inprocess-http.cjs');
const { db } = require('../src/db/connection');
const wallet = require('../src/modules/wallet/wallet.service');
const { fork } = require('child_process');
const path = require('path');
let a, b, conv;
beforeAll(async () => {
  a = await makeUser({ username: 'f06-sender' }); b = await makeUser({ username: 'f06-receiver' });
  await befriend(a, b); conv = await privateConversation(a, b);
  wallet.applyDelta(a.userId, 2000, 'recharge');
  wallet.applyDelta(b.userId, 2000, 'recharge');
});
afterAll(async () => { await require('../src/db/writer').shutdown(); });
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
  const first = await post(url, body, key); // Client loses this response after the server commits.
  expect(first.status).toBe(200);
  const retries = await Promise.all(Array.from({ length: 5 }, () => post(url, body, key)));
  expect(wallet.getBalance(a.userId)).toBe(before - 10);
  expect(retries.map(r => r.body)).toEqual(Array(5).fill(first.body));
});
test('same key with changed payload is rejected, preserving the original result', async () => {
  const key = 'f06-payload-conflict';
  const before = wallet.getBalance(a.userId);
  expect((await post('/api/wallet/transfer', transfer(10), key)).status).toBe(200);
  expect((await post('/api/wallet/transfer', transfer(20), key)).status).toBe(409);
  expect(wallet.getBalance(a.userId)).toBe(before - 10);
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
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('message', msg => msg.ready ? resolve() : reject(new Error('fixture not ready')));
  });
  const done = new Promise(resolve => {
    let result;
    child.on('message', msg => { if (!msg.ready) result = msg; });
    child.once('exit', (code, signal) => resolve({ code, signal, ...result }));
  });
  return { ready, done, send: input => child.send({ actorId: a.userId, payload: transfer(3), ...input }) };
}
test('two actual processes racing on one key commit exactly one transfer', async () => {
  const before = wallet.getBalance(a.userId);
  const clients = [processClient(), processClient()];
  await Promise.all(clients.map(c => c.ready));
  clients.forEach(c => c.send({ key: 'f06-process-concurrent', mode: 'normal' }));
  const results = await Promise.all(clients.map(c => c.done));
  expect(results.map(r => r.code)).toEqual([0, 0]);
  expect(results[0].result).toEqual(results[1].result);
  expect(wallet.getBalance(a.userId)).toBe(before - 3);
});
test.each(['beforeCommit', 'afterCommit'])('SIGKILL %s preserves atomicity and retry after restart is safe', async mode => {
  const before = wallet.getBalance(a.userId);
  const key = `f06-process-kill-${mode}`;
  const child = processClient();
  await child.ready;
  child.send({ key, mode });
  expect((await child.done).signal).toBe('SIGKILL');
  expect(wallet.getBalance(a.userId)).toBe(before - (mode === 'afterCommit' ? 3 : 0));
  const saved = db.prepare('SELECT response_json FROM financial_idempotency WHERE actor_id=? AND idempotency_key=?').get(a.userId, key);
  expect(!!saved).toBe(mode === 'afterCommit');
  const retry = await post('/api/wallet/transfer', transfer(3), key);
  expect(retry.status).toBe(200);
  if (saved) expect(retry.body).toEqual(JSON.parse(saved.response_json));
  expect(wallet.getBalance(a.userId)).toBe(before - 3);
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
