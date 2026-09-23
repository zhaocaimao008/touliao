'use strict';
// Read-only checks. Keep each generator's exact comparison and failure status.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const [command, args] of [
  [process.execPath, ['scripts/generate-ui-tokens.cjs', '--check']],
  [process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['scripts/generate-native-design.py', '--check']],
  [process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['scripts/generate-component-tokens.py', '--check']],
]) {
  const result = spawnSync(command, args, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Design token sync: PASS');
