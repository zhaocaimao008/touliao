import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
describe('DS-001 generated design source', () => {
  it('keeps the actual CSS synchronized with the authoritative source', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-ui-tokens.cjs', '--check'], { cwd: root, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
  it('is deterministic and rejects the original missing-theme declarations', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-token-sync-'));
    try {
      for (const file of ['scripts/generate-ui-tokens.cjs', 'web/src/ui-kit/tokens.json']) {
        fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
        fs.copyFileSync(path.join(root, file), path.join(temp, file));
      }
      const run = (...args) => spawnSync(process.execPath, ['scripts/generate-ui-tokens.cjs', ...args], { cwd: temp, encoding: 'utf8' });
      expect(run().status).toBe(0);
      const output = path.join(temp, 'web/src/ui-kit/tokens.css');
      const first = fs.readFileSync(output, 'utf8');
      expect(run().status).toBe(0);
      expect(fs.readFileSync(output, 'utf8')).toBe(first);
      expect(first.match(/--tl-icon-on-dark:/g)).toHaveLength(2);
      expect(first.match(/--tl-icon-on-light:/g)).toHaveLength(2);
      fs.writeFileSync(output, first.replace(/^.*--tl-icon-on-(?:dark|light):.*\n/gm, ''));
      expect(run('--check').status).not.toBe(0);
      expect(run().status).toBe(0);
      expect(run('--check').status).toBe(0);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
});
