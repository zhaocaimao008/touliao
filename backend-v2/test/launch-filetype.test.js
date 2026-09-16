'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

test('malformed ASF upload cannot stall the HTTP event loop (CVE-2026-31808)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-parser-'));
  // Run hostile parser input only in a killable child, never in the test runner.
  const result = spawnSync(process.execPath, ['-e', `
    const fs = require('fs');
    const path = require('path');
    const { verifyChatFile } = require('./src/utils/upload');
    const dir = process.argv[1];
    const file = path.join(dir, 'bad.wmv');
    const data = Buffer.alloc(55);
    Buffer.from('3026b2758e66cf11a6d9', 'hex').copy(data);
    fs.writeFileSync(file, data);
    verifyChatFile(file, 'bad.wmv', 'video/x-ms-wmv')
      .then(() => process.stdout.write('completed'))
      .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  `, dir], { cwd: path.resolve(__dirname, '..'), timeout: 3000, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  expect(result.error?.code).not.toBe('ETIMEDOUT');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('completed');
});

test('multipart array indices are bounded before the field parser runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-multipart-'));
  const result = spawnSync(process.execPath, ['-e', `
    const express = require('express');
    const request = require('supertest');
    const { makeChatUploader } = require('./src/utils/upload');
    const app = express();
    app.post('/upload', ...makeChatUploader(process.argv[1]), (_req, res) => res.json({ok:true}));
    request(app).post('/upload').field('items[4294967294]', 'x').field('items[key]', 'x')
      .then(res => { process.stdout.write(String(res.status)); process.exit(res.status === 400 ? 0 : 1); });
  `, dir], { cwd: path.resolve(__dirname, '..'), timeout: 3000, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  expect(result.error?.code).not.toBe('ETIMEDOUT');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('400');
});
