'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
// 已验签清单绑定的替身；真实 bindManifest/verifyFile 另见 update-trust.test.js。
const binding = Object.freeze({ version: '8.1.30', url: 'touliao-8.1.30-setup.exe', sha512: 'x', size: 1 });
function harness(profile = 1, { pins = [] } = {}) {
  const updater = new EventEmitter(), sent = [], handlers = new Map(), verified = [], helperInstalls = [];
  let downloads = 0, installs = 0;
  const updateTrust = {
    publishers: () => { if (!pins.length) throw new Error('尚未配置可信 Windows 发布者证书'); return pins; },
    verifyFile: (file, bound) => { if (bound !== binding || file !== 'C:\\setup.exe') throw new Error('安装包摘要不一致'); verified.push(file); },
    installVerified: async (args) => { helperInstalls.push(args); },
  };
  updater.downloadUpdate = async () => { downloads++; };
  updater.quitAndInstall = () => { installs++; };
  updater.checkForUpdates = async () => {};
  const context = vm.createContext({
    require: id => { assert.equal(id, './lib/downloads'); return require('../src/lib/downloads'); },
    process: { platform: 'win32', env: {}, resourcesPath: '' }, path, updateTrust, updatePolicy: { channel: 'latest' },
    strictUpdateMode: () => pins.length > 0, trustedUpdate: null, downloadedInstaller: null, updateAttempt: 0, installingUpdate: false,
    shell: {}, NO_AUTO_OPEN_EXTS: new Set(), API_ORIGIN: 'https://touliao.cc', CDN_ORIGIN: '',
    autoUpdater: updater, PROFILE: profile, app: { getVersion: () => '8.1.29' },
    mainWindow: { webContents: { send: (...args) => sent.push(args) } },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    log: { info() {}, error() {} }, isTrustedSender: () => true,
    verifyUpdateSignature: async () => binding, isQuitting: false,
    updateReady: false, updateInstallRequested: false,
  });
  // Execute the real registration functions, without starting Electron or unrelated app services.
  for (const name of ['setupAutoUpdater', 'setupIPC']) {
    const fn = source.match(new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
    assert.ok(fn, name); vm.runInContext(fn[0] + `; ${name}();`, context);
  }
  context.app.quit = () => { context.quit = true; };
  return { updater, context, sent, handlers, verified, helperInstalls, counts: () => ({ downloads, installs }) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
// 真实流程：验签通过 → 下载 → update-downloaded 带回安装包路径。
async function downloaded(h, file = 'C:\\setup.exe') {
  h.updater.emit('update-available', { version: '8.1.30' }); await settle();
  h.updater.emit('update-downloaded', { version: '8.1.30', downloadedFile: file });
}
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
test('install before download gives an error and does not quit', async () => {
  const h = harness(); await assert.rejects(h.handlers.get('update:install')({}), /下载完成/);
  assert.equal(h.counts().installs, 0); assert.equal(h.context.isQuitting, false);
});
test('non-primary account receives an installation refusal instead of silence', async () => {
  const h = harness(2); await downloaded(h);
  await assert.rejects(h.handlers.get('update:install')({}), /账号窗口 1/);
  assert.equal(h.counts().installs, 0);
});
test('installer errors restore normal app quit behavior and repeated clicks do not start twice', async () => {
  const h = harness(); await downloaded(h);
  await h.handlers.get('update:install')({}); await h.handlers.get('update:install')({});
  assert.equal(h.counts().installs, 1); assert.equal(h.context.isQuitting, true);
  h.updater.emit('error', new Error('installer denied'));
  assert.equal(h.context.isQuitting, false); assert.equal(h.context.updateInstallRequested, false);
  assert.ok(h.sent.some(([name, text]) => name === 'update:error' && text === 'installer denied'));
});
test('synchronous installer failure is returned and does not leave the app quitting', async () => {
  const h = harness(); await downloaded(h);
  h.updater.quitAndInstall = () => { throw new Error('unable to start installer'); };
  await assert.rejects(h.handlers.get('update:install')({}), /unable to start installer/);
  assert.equal(h.context.isQuitting, false); assert.equal(h.context.updateInstallRequested, false);
});
test('untrusted frames still cannot trigger installation', async () => {
  const h = harness(); await downloaded(h); h.context.isTrustedSender = () => false;
  await h.handlers.get('update:install')({});
  assert.equal(h.counts().installs, 0);
});
test('signature mode binds the downloaded installer to the signed manifest before installing', async () => {
  const h = harness(); await downloaded(h);
  await h.handlers.get('update:install')({});
  assert.deepEqual(h.verified, ['C:\\setup.exe', 'C:\\setup.exe']);
  assert.equal(h.counts().installs, 1); assert.equal(h.helperInstalls.length, 0);
});
test('a download that does not match the signed manifest is never offered for installation', async () => {
  const h = harness(); await downloaded(h, 'C:\\other.exe');
  assert.ok(h.sent.some(([name, text]) => name === 'update:error' && text.includes('校验失败')));
  assert.ok(!h.sent.some(([name]) => name === 'update:downloaded'));
  await assert.rejects(h.handlers.get('update:install')({}), /下载完成/);
  assert.equal(h.counts().installs, 0);
});
test('configured publisher pins switch installation to the verified helper', async () => {
  const h = harness(1, { pins: ['A'.repeat(40)] }); await downloaded(h);
  await h.handlers.get('update:install')({});
  assert.equal(h.counts().installs, 0);
  assert.equal(h.helperInstalls.length, 1);
  assert.equal(h.helperInstalls[0].binding, binding); assert.equal(h.helperInstalls[0].filename, 'C:\\setup.exe');
  assert.equal(h.context.quit, true);
});
test('an update check during a pending installation cannot replace the verified binding', async () => {
  const h = harness(); await downloaded(h);
  await h.handlers.get('update:install')({});
  h.updater.emit('update-available', { version: '8.1.31' }); await settle();
  assert.equal(h.context.trustedUpdate, binding); assert.equal(h.counts().downloads, 1);
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
