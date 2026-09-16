'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const web = path.resolve(__dirname, '../web');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-capacitor-'));
try {
  fs.copyFileSync(path.join(web, 'package.json'), path.join(temp, 'package.json'));
  fs.symlinkSync(path.join(web, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(temp, 'dist'));
  fs.writeFileSync(path.join(temp, 'dist/index.html'), '<!doctype html><title>Capacitor test</title>');
  fs.writeFileSync(path.join(temp, 'capacitor.config.json'), JSON.stringify({ appId: 'com.touliao.synctest', appName: 'Sync Test', webDir: 'dist' }));
  for (const args of [['add', 'android'], ['sync', 'android']]) {
    execFileSync(process.execPath, [path.join(web, 'node_modules/@capacitor/cli/bin/capacitor'), ...args], { cwd: temp, stdio: 'inherit' });
  }
  assert.ok(fs.existsSync(path.join(temp, 'android/app/src/main/assets/public/index.html')));
  console.log('Capacitor Android template extraction and sync passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
