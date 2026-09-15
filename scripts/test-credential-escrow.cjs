'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { validate, names } = require('../deploy/credential-escrow.cjs');
function fixture() {
  const key = crypto.generateKeyPairSync('ed25519');
  const apple = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { format: 1, repository: 'zhaocaimao008/touliao', createdAt: new Date().toISOString(), updatePublicKey: key.publicKey.export({ type: 'spki', format: 'pem' }).toString(), secrets: {
    ...Object.fromEntries(names.map(name => [name, 'test-value'])),
    UPDATE_PRIVATE_KEY: key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    ASC_API_KEY_BASE64: Buffer.from(apple.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
  } };
}
test('credentials preserve signing identity and explicitly report unavailable Windows publisher', () => {
  const result = validate(fixture());
  assert.equal(result.credentials, 18);
  assert.equal(result.updateKeyVerified, true);
  assert.equal(result.windowsPublisherAvailable, false);
});
test('missing signing material is a failure, not a partial-success backup', () => {
  const value = fixture(); delete value.secrets.ANDROID_KEYSTORE_BASE64;
  assert.throws(() => validate(value));
});
test('recovery identity and unexpected credentials cannot enter this escrow', () => {
  const value = fixture(); value.secrets.BACKUP_AGE_IDENTITY = 'must not be included';
  assert.throws(() => validate(value));
});
test('mismatched public key is rejected', () => {
  const value = fixture(); value.updatePublicKey = fixture().updatePublicKey;
  assert.throws(() => validate(value));
});
