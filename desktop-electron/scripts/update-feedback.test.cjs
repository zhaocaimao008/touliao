'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
function harness(profile = 1) {
  const updater = new EventEmitter(), sent = [], handlers = new Map();
  let downloads = 0, installs = 0;
  updater.downloadUpdate = async () => { downloads++; };
  updater.quitAndInstall = () => { installs++; };
  updater.checkForUpdates = async () => {};
  const context = vm.createContext({
    require: id => { assert.equal(id, './lib/downloads'); return require('../src/lib/downloads'); },
    shell: {}, NO_AUTO_OPEN_EXTS: new Set(), API_ORIGIN: 'https://touliao.cc', CDN_ORIGIN: '',
    autoUpdater: updater, PROFILE: profile, app: { getVersion: () => '8.1.29' },
    mainWindow: { webContents: { send: (...args) => sent.push(args) } },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    log: { info() {}, error() {} }, isTrustedSender: () => true,
    verifyUpdateSignature: async () => 'ok', isQuitting: false,
    updateReady: false, updateInstallRequested: false,
  });
  // Execute the real registration functions, without starting Electron or unrelated app services.
  for (const name of ['setupAutoUpdater', 'setupIPC']) {
    const fn = source.match(new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
    assert.ok(fn, name); vm.runInContext(fn[0] + `; ${name}();`, context);
  }
  return { updater, context, sent, handlers, counts: () => ({ downloads, installs }) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('no available update reaches the renderer with the installed version', () => {
  const h = harness(); h.updater.emit('update-not-available', { version: '8.1.27' });
  const event = h.sent.find(([name]) => name === 'update:not-available');
  assert.ok(event); assert.equal(event[1].version, '8.1.29');
});
test('download rejection is visible even without an updater error event', async () => {
  const h = harness(); h.updater.downloadUpdate = async () => { throw new Error('network interrupted'); };
  h.updater.emit('update-available', { version: '8.1.30' }); await settle();
  assert.ok(h.sent.some(([name, text]) => name === 'update:error' && text.includes('network interrupted')));
});
test('invalid update signature still prevents downloading', async () => {
  const h = harness(); h.context.verifyUpdateSignature = async () => 'fail';
  h.updater.emit('update-available', { version: '8.1.30' }); await settle();
  assert.equal(h.counts().downloads, 0); assert.ok(h.sent.some(([name]) => name === 'update:error'));
});
test('install before download gives an error and does not quit', () => {
  const h = harness(); assert.throws(() => h.handlers.get('update:install')({}), /下载完成/);
  assert.equal(h.counts().installs, 0); assert.equal(h.context.isQuitting, false);
});
test('non-primary account receives an installation refusal instead of silence', () => {
  const h = harness(2); h.updater.emit('update-downloaded', { version: '8.1.30' });
  assert.throws(() => h.handlers.get('update:install')({}), /账号窗口 1/);
  assert.equal(h.counts().installs, 0);
});
test('installer errors restore normal app quit behavior and repeated clicks do not start twice', () => {
  const h = harness(); h.updater.emit('update-downloaded', { version: '8.1.30' });
  h.handlers.get('update:install')({}); h.handlers.get('update:install')({});
  assert.equal(h.counts().installs, 1); assert.equal(h.context.isQuitting, true);
  h.updater.emit('error', new Error('installer denied'));
  assert.equal(h.context.isQuitting, false); assert.equal(h.context.updateInstallRequested, false);
  assert.ok(h.sent.some(([name, text]) => name === 'update:error' && text === 'installer denied'));
});
test('synchronous installer failure is returned and does not leave the app quitting', () => {
  const h = harness(); h.updater.emit('update-downloaded', { version: '8.1.30' });
  h.updater.quitAndInstall = () => { throw new Error('unable to start installer'); };
  assert.throws(() => h.handlers.get('update:install')({}), /unable to start installer/);
  assert.equal(h.context.isQuitting, false); assert.equal(h.context.updateInstallRequested, false);
});
test('untrusted frames still cannot trigger installation', () => {
  const h = harness(); h.context.isTrustedSender = () => false;
  h.updater.emit('update-downloaded', { version: '8.1.30' }); h.handlers.get('update:install')({});
  assert.equal(h.counts().installs, 0);
});
test('preload forwards no-update completion to the existing renderer bridge', () => {
  const listeners = new Map(), events = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { on: (key, fn) => listeners.set(key, fn) } }),
    process: { platform: 'win32', argv: [] }, window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
  });
  assert.ok(listeners.has('update:not-available'));
  listeners.get('update:not-available')(null, { version: '8.1.29' });
  assert.equal(events[0].type, 'electron:update-not-available'); assert.equal(events[0].detail.version, '8.1.29');
});
