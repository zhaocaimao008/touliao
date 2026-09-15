'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('../desktop-electron/node_modules/js-yaml');
const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/windows-build.yml'), 'utf8'));
const steps = workflow.jobs.deploy.steps;
const transfer = steps.find(step => step.name === 'SCP 到服务器').run.replace(/\$\{\{[^}]+\}\}/g, 'fixture');
const verify = steps.at(-1).run;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-publish-test-'));
try {
  fs.cpSync(path.resolve(process.argv[2]), path.join(temp, 'artifacts'), { recursive: true });
  // Model ssh's default stdin consumption using the actual workflow upload loop.
  const mock = 'ssh() { case " $* " in *" -n "*) ;; *) cat >/dev/null ;; esac; }; scp() { printf "%s\\n" "$*" >> "$TEST_LOG"; };\n';
  const result = spawnSync('bash', ['-e', '-c', mock + transfer], {
    cwd: temp, env: { ...process.env, TEST_LOG: path.join(temp, 'uploads.log') }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const uploads = fs.readFileSync(path.join(temp, 'uploads.log'), 'utf8');
  for (const name of ['.latest.yml.pending', '.latest.yml.sig.pending', '.exe.blockmap.pending']) assert.ok(uploads.includes(name), name);
  const file = path.join(temp, 'artifacts/latest.yml');
  const original = fs.readFileSync(file);
  fs.appendFileSync(file, '\n');
  const mismatch = spawnSync('bash', ['-e', '-c', verify], { cwd: temp, encoding: 'utf8', timeout: 240000 });
  assert.equal(mismatch.status, 1, 'Different published metadata must fail the release check');
  assert.ok(mismatch.stdout.includes('differs from the verified artifact'));
  fs.writeFileSync(file, original);
  const good = spawnSync('bash', ['-e', '-c', verify], { cwd: temp, encoding: 'utf8', timeout: 240000 });
  assert.equal(good.status, 0, good.stdout + good.stderr);
  console.log(JSON.stringify({ allMetadataTransferred: true, staleMetadataRejected: true, publicBytesVerified: true }));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
