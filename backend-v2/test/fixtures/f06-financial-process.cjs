'use strict';
// Synthetic isolated DB only, inherited from Jest testEnv. Never load deployment env.
if (process.env.NODE_ENV !== 'test' || !process.env.DB_PATH?.includes('.tmp-test-db.sqlite')) throw new Error('isolated test DB required');
const { db } = require('../../src/db/connection');
const wallet = require('../../src/modules/wallet/wallet.service');
process.send({ ready: true });
process.once('message', async ({ actorId, payload, key, mode }) => {
  try {
    if (mode === 'beforeCommit') {
      db.function('f06_crash', () => process.kill(process.pid, 'SIGKILL'));
      db.exec(`CREATE TEMP TRIGGER f06_crash_before_commit BEFORE INSERT ON financial_idempotency
        BEGIN SELECT f06_crash(); END`);
    }
    const result = await wallet.transfer(actorId, payload, null, key);
    if (mode === 'afterCommit') process.kill(process.pid, 'SIGKILL');
    else process.send({ result }, () => process.exit(0));
  } catch (error) {
    process.send({ error: error.message }, () => process.exit(1));
  }
});
