'use strict';
// Keep SQLite real; only the optional Redis transport is held/faulted deterministically.
const mockClient = { on: jest.fn(), connect: jest.fn(async () => {}), setEx: jest.fn(async () => {}), exists: jest.fn(async () => 0) };
jest.mock('redis', () => ({ createClient: () => mockClient }));
process.env.REDIS_URL = 'redis://q02-test.invalid';
const { db } = require('../src/db/connection');
const { addToBlacklist, isBlacklisted, credentialKey } = require('../src/utils/tokenBlacklist');
beforeAll(async () => { await Promise.resolve(); });
afterAll(() => { delete process.env.REDIS_URL; });

test('a Redis write pause cannot refill a clean-cache entry that survives committed revocation', async () => {
  const token = 'q02-synthetic-race-credential';
  const fingerprint = credentialKey(token);
  let release;
  mockClient.setEx.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  expect(await isBlacklisted(token)).toBe(false);
  expect(await isBlacklisted(fingerprint)).toBe(false);
  const revocation = addToBlacklist(token, Math.floor(Date.now() / 1000) + 600);
  // A request interleaved while Redis is still pending must not retain a clean answer.
  await isBlacklisted(token);
  await isBlacklisted(fingerprint);
  release();
  await revocation;
  expect(await isBlacklisted(token)).toBe(true);
  expect(await isBlacklisted(fingerprint)).toBe(true);
});

test('Redis write failure still durably revokes both original and fingerprint keys', async () => {
  const token = 'q02-synthetic-redis-failure';
  mockClient.setEx.mockRejectedValueOnce(new Error('synthetic Redis outage'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await addToBlacklist(token, Math.floor(Date.now() / 1000) + 600);
    expect(await isBlacklisted(token)).toBe(true);
    expect(await isBlacklisted(credentialKey(token))).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM token_blacklist WHERE token IN (?,?)').get(token, credentialKey(token)).n).toBe(2);
  } finally { log.mockRestore(); }
});

test('a failed durable fingerprint write rolls back both keys and reports revocation failure', async () => {
  db.exec("CREATE TEMP TRIGGER q02_revoke_fail BEFORE INSERT ON token_blacklist WHEN NEW.token LIKE 'credential:%' BEGIN SELECT RAISE(ABORT, 'synthetic durability failure'); END");
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(addToBlacklist('q02-durable-failure', Math.floor(Date.now() / 1000) + 600)).rejects.toMatchObject({
      message: 'synthetic durability failure', code: 'SQLITE_CONSTRAINT_TRIGGER',
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM token_blacklist WHERE token=?').get('q02-durable-failure').n).toBe(0);
  } finally {
    db.exec('DROP TRIGGER q02_revoke_fail');
    log.mockRestore();
  }
});
