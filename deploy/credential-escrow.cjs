'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const names = [
  'ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD',
  'ASC_API_KEY_BASE64', 'ASC_ISSUER_ID', 'ASC_KEY_ID', 'DEPLOY_SERVER_HOST', 'DEPLOY_SSH_KEY', 'DEPLOY_USER',
  'GETUI_APP_ID', 'GETUI_APP_KEY', 'GETUI_APP_SECRET', 'IOS_CERTIFICATE_P12_BASE64', 'IOS_CERTIFICATE_PASSWORD',
  'IOS_KEYCHAIN_PASSWORD', 'IOS_PROVISIONING_PROFILE_BASE64', 'UPDATE_PRIVATE_KEY',
];
const optional = ['WINDOWS_CERTIFICATE_BASE64', 'WINDOWS_CERTIFICATE_PASSWORD'];
function validate(record) {
  if (record.format !== 1 || record.repository !== 'zhaocaimao008/touliao' || !Number.isFinite(Date.parse(record.createdAt))) throw new Error('Invalid escrow metadata');
  if (Object.keys(record.secrets).some(name => ![...names, ...optional].includes(name))) throw new Error('Unexpected escrow key');
  for (const name of names) {
    if (typeof record.secrets[name] !== 'string' || (!record.secrets[name] && name !== 'IOS_CERTIFICATE_PASSWORD')) throw new Error(`Missing required credential: ${name}`);
  }
  const key = crypto.createPrivateKey(record.secrets.UPDATE_PRIVATE_KEY);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Invalid update key type');
  if (crypto.createPrivateKey(Buffer.from(record.secrets.ASC_API_KEY_BASE64, 'base64')).asymmetricKeyType !== 'ec') throw new Error('Invalid App Store Connect key type');
  const publicKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
  if (publicKey !== record.updatePublicKey) throw new Error('Update key identity mismatch');
  const payload = Buffer.from('touliao-recovery-key-check');
  if (!crypto.verify(null, payload, publicKey, crypto.sign(null, payload, key))) throw new Error('Update signing round trip failed');
  return { credentials: names.length, windowsPublisherAvailable: !!record.secrets.WINDOWS_CERTIFICATE_BASE64, updateKeyVerified: true, createdAt: record.createdAt };
}
function seal(output, recipientFile, publicKeyFile) {
  const record = { format: 1, repository: 'zhaocaimao008/touliao', createdAt: new Date().toISOString(), sourceCommit: process.env.GITHUB_SHA || '', secrets: {}, updatePublicKey: fs.readFileSync(publicKeyFile, 'utf8') };
  for (const name of [...names, ...optional]) record.secrets[name] = process.env[`ESCROW_${name}`] || '';
  const summary = validate(record);
  if (fs.existsSync(output)) throw new Error('Escrow output already exists');
  const encrypted = spawnSync('age', ['-R', recipientFile, '-o', output], { input: JSON.stringify(record), maxBuffer: 1024 * 1024 });
  if (encrypted.status !== 0) { fs.rmSync(output, { force: true }); throw new Error('Credential encryption failed'); }
  fs.chmodSync(output, 0o600);
  console.log(JSON.stringify({ encrypted: true, ...summary }));
}
if (require.main === module) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'seal' && args.length === 3) seal(...args);
    else if (mode === 'verify' && args.length === 1) console.log(JSON.stringify(validate(JSON.parse(fs.readFileSync(args[0], 'utf8')))));
    else throw new Error('Usage: credential-escrow.cjs seal OUTPUT RECIPIENT PUBLIC_KEY | verify JSON');
  } catch {
    console.error('Credential escrow failed; credential values are intentionally omitted.');
    process.exitCode = 1;
  }
}
module.exports = { validate, names, optional };
