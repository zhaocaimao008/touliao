'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
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
function verifyMaterials(record, publicKeyFile, apk) {
  const summary = validate(record);
  if (record.updatePublicKey !== fs.readFileSync(publicKeyFile, 'utf8')) throw new Error('Published update key mismatch');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-signing-check-'));
  fs.chmodSync(directory, 0o700);
  const secret = record.secrets;
  const env = { ...process.env, RECOVERY_STORE: secret.ANDROID_KEYSTORE_PASSWORD, RECOVERY_KEY: secret.ANDROID_KEY_PASSWORD,
    RECOVERY_TEMP: crypto.randomBytes(24).toString('hex'), RECOVERY_IOS: secret.IOS_CERTIFICATE_PASSWORD };
  const run = (command, args, input) => {
    const result = spawnSync(command, args, { env, input, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('Signing material check failed');
    return result.stdout;
  };
  const write = (name, value) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, Buffer.from(value, 'base64'), { mode: 0o600, flag: 'wx' });
    return file;
  };
  try {
    const jks = write('android.jks', secret.ANDROID_KEYSTORE_BASE64);
    run('keytool', ['-importkeystore', '-srckeystore', jks, '-srcstorepass:env', 'RECOVERY_STORE', '-srckeypass:env', 'RECOVERY_KEY',
      '-srcalias', secret.ANDROID_KEY_ALIAS, '-destkeystore', path.join(directory, 'android.p12'), '-deststoretype', 'PKCS12', '-deststorepass:env', 'RECOVERY_TEMP', '-noprompt']);
    const androidCert = new crypto.X509Certificate(run('keytool', ['-exportcert', '-keystore', jks, '-storepass:env', 'RECOVERY_STORE', '-alias', secret.ANDROID_KEY_ALIAS]));
    const androidFingerprint = androidCert.fingerprint256.replaceAll(':', '').toLowerCase();
    const apkReport = run('apksigner', ['verify', '--print-certs', apk]).toString();
    if (!apkReport.includes(`Signer #1 certificate SHA-256 digest: ${androidFingerprint}`)) throw new Error('Android published signer mismatch');
    const p12 = write('ios.p12', secret.IOS_CERTIFICATE_P12_BASE64);
    const iosArgs = ['pkcs12', '-legacy', '-in', p12, '-passin', 'env:RECOVERY_IOS'];
    const iosKey = crypto.createPrivateKey(run('openssl', [...iosArgs, '-nocerts', '-nodes']));
    const iosCert = new crypto.X509Certificate(run('openssl', [...iosArgs, '-clcerts', '-nokeys']));
    if (!iosCert.checkPrivateKey(iosKey)) throw new Error('iOS certificate/private key mismatch');
    const profile = write('ios.mobileprovision', secret.IOS_PROVISIONING_PROFILE_BASE64);
    const plist = run('openssl', ['cms', '-verify', '-inform', 'DER', '-in', profile, '-noverify']);
    const info = JSON.parse(run('python3', ['-c', "import sys,plistlib,json,base64; p=plistlib.loads(sys.stdin.buffer.read()); print(json.dumps({'app':p['Entitlements']['application-identifier'],'expires':p['ExpirationDate'].isoformat()+'Z','certificates':[base64.b64encode(c).decode() for c in p['DeveloperCertificates']]}))"], plist));
    if (!info.app.endsWith('.com.touliao.app') || !info.certificates.some(c => new crypto.X509Certificate(Buffer.from(c, 'base64')).fingerprint256 === iosCert.fingerprint256)) throw new Error('iOS provisioning identity mismatch');
    return { ...summary, androidPrivateKeyVerified: true, androidPublishedSignerVerified: true, androidCertificateSha256: androidFingerprint,
      iosPrivateKeyVerified: true, iosProfileVerified: true, iosCertificateExpires: iosCert.validTo, iosProfileExpires: info.expires };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
if (require.main === module) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'seal' && args.length === 3) seal(...args);
    else if (mode === 'verify' && args.length === 1) console.log(JSON.stringify(validate(JSON.parse(fs.readFileSync(args[0], 'utf8')))));
    else if (mode === 'verify-materials' && args.length === 3) console.log(JSON.stringify(verifyMaterials(JSON.parse(fs.readFileSync(args[0], 'utf8')), args[1], args[2])));
    else throw new Error('Usage: credential-escrow.cjs seal OUTPUT RECIPIENT PUBLIC_KEY | verify JSON');
  } catch {
    console.error('Credential escrow failed; credential values are intentionally omitted.');
    process.exitCode = 1;
  }
}
module.exports = { validate, names, optional, verifyMaterials };
