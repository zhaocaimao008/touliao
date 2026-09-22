'use strict';

const { Worker } = require('worker_threads');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applySchema } = require('../src/db/schema');

async function withWorker(check) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-worker-contention-'));
  const dbPath = path.join(root, 'isolated.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  applySchema(db);
  db.exec(`INSERT INTO users(id,username,phone,password) VALUES('sender','test','synthetic','test');
    INSERT INTO conversations(id,type) VALUES('conversation','group');
    INSERT INTO wallets(user_id,balance) VALUES('sender',0)`);
  const worker = new Worker(path.join(__dirname, '../src/db/worker.js'), {
    workerData: { dbPath, flushMs: 20 },
  });
  let reqId = 0;
  const pending = new Map();
  worker.on('message', msg => {
    if (msg.type === 'ack') for (const id of msg.ids) pending.get(id)?.(msg);
  });
  const send = item => new Promise((resolve, reject) => {
    const id = ++reqId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Worker ack timeout: reqId=${id}, pending=${pending.size}`));
    }, 12000);
    pending.set(id, msg => {
      clearTimeout(timeout);
      pending.delete(id);
      resolve(msg);
    });
    worker.postMessage({ reqId: id, ...item });
  });
  try {
    // Finish worker connection initialization before another connection takes its lock.
    expect((await send({ type: 'writeBatch', ops: [] })).error).toBeUndefined();
    await check(db, send);
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK');
    await new Promise(resolve => {
      worker.once('exit', resolve);
      worker.postMessage({ type: 'shutdown' });
    });
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const balanceOp = { sql: "UPDATE wallets SET balance=balance+10 WHERE user_id='sender'", params: [] };
const messageOp = {
  sql: "INSERT INTO messages(id,conversation_id,sender_id,content) VALUES(lower(hex(randomblob(16))),'conversation','sender','contention probe')",
  params: [],
};
const ledgerOp = {
  sql: "INSERT INTO wallet_transactions(id,user_id,amount,balance_after,type) VALUES(lower(hex(randomblob(16))),'sender',10,10,'recharge')",
  params: [],
};

test.each(['write', 'writeBatch', 'writeSequencedEvent'])(
  '%s waits for a competing writer and replays its receipt without duplicate writes',
  async type => withWorker(async (db, send) => {
    const item = { type, operationId: 'same-operation' };
    if (type === 'write') Object.assign(item, balanceOp);
    else item.ops = [balanceOp, messageOp, ledgerOp];
    if (type === 'writeSequencedEvent') Object.assign(item, {
      conversationId: 'conversation',
      event: { id: 'event', eventType: 'message_created', messageId: 'message', actorId: 'sender', createdAt: 1 },
    });

    // A real, separate SQLite connection holds a short write transaction. With a
    // deferred worker transaction, reading the receipt first makes the upgrade
    // fail immediately, even though the 10-second busy timeout has not expired.
    db.exec('BEGIN IMMEDIATE');
    db.prepare("UPDATE wallets SET balance=balance WHERE user_id='sender'").run();
    const released = new Promise(resolve => setTimeout(() => { db.exec('COMMIT'); resolve(); }, 100));
    const first = await send(item);
    await released;
    expect(first.error).toBeUndefined();
    const replays = await Promise.all([send(item), send(item)]);
    for (const replay of replays) {
      expect(replay.error).toBeUndefined();
      expect(replay.result).toEqual(first.result);
    }
    expect(db.prepare('SELECT balance FROM wallets').get().balance).toBe(10);
    expect(db.prepare('SELECT count(*) AS n FROM writer_receipts').get().n).toBe(1);
    for (const table of ['messages', 'wallet_transactions']) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n).toBe(type === 'write' ? 0 : 1);
    }
    expect(db.prepare('SELECT count(*) AS n FROM conversation_events').get().n).toBe(type === 'writeSequencedEvent' ? 1 : 0);
    if (type === 'writeSequencedEvent') {
      expect(first.result).toEqual({ server_sequence: 1 });
      expect(db.prepare('SELECT last_sequence FROM conversation_sequences').get().last_sequence).toBe(1);
    }
  }), 20000,
);

test('a bad batch rolls back domain writes and receipts; fallback and replay commit the good item once', async () => {
  await withWorker(async (db, send) => {
    const bad = { type: 'writeBatch', operationId: 'bad', ops: [balanceOp, { sql: 'INSERT INTO missing_table VALUES(1)', params: [] }] };
    const good = { type: 'writeBatch', operationId: 'good', ops: [balanceOp, messageOp, ledgerOp] };
    const [failed, committed] = await Promise.all([send(bad), send(good)]);
    expect(failed.error).toMatch(/no such table/);
    expect(committed.error).toBeUndefined();
    expect((await send(good)).error).toBeUndefined();
    expect(db.prepare('SELECT balance FROM wallets').get().balance).toBe(10);
    expect(db.prepare('SELECT operation_id FROM writer_receipts').all()).toEqual([{ operation_id: 'good' }]);
    for (const table of ['messages', 'wallet_transactions']) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n).toBe(1);
    }
  });
}, 20000);
