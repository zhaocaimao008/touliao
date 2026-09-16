'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('../desktop-electron/node_modules/js-yaml');
const dir = path.resolve(process.argv[2]);
async function digest(stream) {
  const sha256 = crypto.createHash('sha256'), sha512 = crypto.createHash('sha512');
  let size = 0;
  for await (const chunk of stream) { size += chunk.length; sha256.update(chunk); sha512.update(chunk); }
  return { size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64') };
}
(async () => {
  const feed = fs.readFileSync(path.join(dir, 'latest.yml'));
  const signature = fs.readFileSync(path.join(dir, 'latest.yml.sig'));
  const key = fs.readFileSync(path.join(__dirname, '../desktop-electron/src/update-public-key.pem'));
  assert.equal(crypto.verify(null, feed, key, signature), true, 'Valid Ed25519 update signature');
  const metadata = yaml.load(feed);
  assert.equal(metadata.files.length, 1);
  const file = metadata.files[0];
  assert.equal(file.url, `touliao-${metadata.version}-setup.exe`);
  assert.match(file.url, /^touliao-\d+\.\d+\.\d+-setup\.exe$/);
  assert.equal(metadata.path, file.url);
  assert.equal(metadata.sha512, file.sha512);
  const local = await digest(fs.createReadStream(path.join(dir, file.url)));
  assert.equal(local.size, file.size);
  assert.equal(local.sha512, file.sha512);
  assert.ok(fs.statSync(path.join(dir, `${file.url}.blockmap`)).size > 0);
  if (process.env.VERIFY_PUBLIC === '1') {
    const base = 'https://touliao.cc/downloads';
    for (const [name, expected] of [['latest.yml', feed], ['latest.yml.sig', signature]]) {
      const response = await fetch(`${base}/updates/${name}`);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    }
    for (const url of [`updates/${file.url}`, 'touliao-windows-latest.exe', 'touliao-windows-latest-setup.exe']) {
      const response = await fetch(`${base}/${url}`);
      assert.equal(response.status, 200, url);
      assert.deepEqual(await digest(response.body), local, url);
    }
    const response = await fetch(`${base}/updates/${file.url}.blockmap`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(dir, `${file.url}.blockmap`)));
  }
  console.log(JSON.stringify({ version: metadata.version, ed25519: true, ...local, publicVerified: process.env.VERIFY_PUBLIC === '1' }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
