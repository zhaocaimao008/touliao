'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const approval = process.argv[3] || '8127';
assert.ok(['8127', '8129', '8132'].includes(approval), 'Exact user-approved release only');
const spec = require(`./windows-${approval}-publication.json`);
const dir = path.resolve(process.argv[2]);
for (const [name, expected] of Object.entries(spec.files)) {
  const bytes = fs.readFileSync(path.join(dir, name));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, name);
}
const yml = fs.readFileSync(path.join(dir, 'latest.yml'));
assert.ok(crypto.verify(null, yml, fs.readFileSync(path.join(__dirname, '../desktop-electron/src/update-public-key.pem')),
  fs.readFileSync(path.join(dir, 'latest.yml.sig'))), 'Historical-client Ed25519 trust chain');
const exe = fs.readFileSync(path.join(dir, `touliao-${spec.version}-setup.exe`));
const sha512 = crypto.createHash('sha512').update(exe).digest('base64');
// 8.1.32 起签名脚本用 js-yaml 输出（长值折叠为 `>-`），按 YAML 解析后比对，不做字符串包含匹配。
const yaml = require(path.join(__dirname, '../desktop-electron/node_modules/js-yaml'));
const manifest = yaml.load(yml.toString(), { schema: yaml.JSON_SCHEMA });
assert.equal(manifest.version, spec.version);
assert.equal(manifest.files.length, 1);
assert.equal(manifest.files[0].url, `touliao-${spec.version}-setup.exe`);
assert.equal(manifest.files[0].sha512, sha512);
assert.equal(manifest.files[0].size, exe.length);
if (manifest.sha512 !== undefined) assert.equal(manifest.sha512, sha512);
console.log(JSON.stringify({ version: spec.version, buildRun: spec.buildRun, sourceCommit: spec.buildCommit,
  sha256: spec.files[`touliao-${spec.version}-setup.exe`], bytes: exe.length, ed25519: true, authenticode: false }));
