'use strict';
// Runs the installed historical Windows executable, never a browser substitute.
// Only account APIs are isolated fixtures. Main-process update traffic is real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE);
assert.equal(process.platform, 'win32', 'Native Windows runner required');
const out = path.resolve('legacy-evidence/windows');
fs.mkdirSync(out, { recursive: true });
const token = 'isolated-windows-upgrade-token';
const user = { id: 'legacy-me', username: 'UpgradeProbe', phone: '13900000001' };
const conv = { id: 'legacy-chat', type: 'private', name: 'LegacyPeer', lastMessage: 'Open cached history', lastTime: 1789747200, otherUser: { id: 'legacy-peer', username: 'LegacyPeer' } };
const message = { id: 'legacy-message', conversation_id: conv.id, sender_id: 'legacy-peer', senderName: 'LegacyPeer', type: 'text', content: 'LEGACY-CACHED-MESSAGE-MUST-SURVIVE', created_at: 1789747100 };
let loginCount = 0;
const report = { environment: 'GitHub Windows native VM', physicalDevice: false, productionAccountTested: false,
  historicalInstaller: '8.1.26', hotUpdate: false, targetUiUpgradeTested: false, targetUiUpgradeBlocked: 'No signed 8.1.27 installer; no hot-resource loader in 8.1.26', passed: false };
async function launch() {
  const app = await _electron.launch({ executablePath: process.env.LEGACY_EXE,
    args: ['--profile=1'], timeout: 90000,
    env: { ...process.env, TOULIAO_LOG_LEVEL: 'info', APPDATA: path.join(process.env.RUNNER_TEMP, 'legacy-profile-root') } });
  await app.context().route('**/api/**', route => {
    const request = route.request(), p = new URL(request.url()).pathname;
    let status = 200, body = {};
    if (p === '/api/auth/login') { loginCount++; body = { token, user }; }
    else if (p === '/api/auth/me') { status = request.headers()['authorization'] === 'Bearer ' + token ? 200 : 401; body = status === 200 ? user : {}; }
    else if (p === '/api/auth/refresh') { status = 401; }
    else if (p === '/api/config') body = { features: { loginCaptcha: false } };
    else if (p === '/api/csrf') body = { csrfToken: 'isolated-only' };
    else if (p === '/api/messages/conversations') body = [conv];
    else if (p === '/api/messages/legacy-chat') body = [message];
    else if (p.endsWith('/sync')) body = { messages: [message], cursor: 1, hasMore: false };
    else if (p.endsWith('/read-states')) body = { states: {} };
    else if (/contacts|pinned-messages|friend-requests|my-groups|friend-labels|blocked|collections|moments|call-logs|sessions/.test(p)) body = [];
    return route.fulfill({ status, json: body });
  });
  await app.context().routeWebSocket(/.*/, ws => ws.close());
  const page = await app.firstWindow();
  await page.reload();
  return { app, page };
}
async function cache(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('touliao', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const store = db.transaction('msgcache_v1').objectStore('msgcache_v1');
      const read = store.getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => reject(read.error);
    };
  }));
}
(async () => {
  let active;
  try {
    active = await launch();
    let { app, page } = active;
    report.runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged,
      appPath: app.getAppPath(), userData: app.getPath('userData'), platform: process.platform }));
    assert.equal(report.runtime.version, '8.1.26'); assert.equal(report.runtime.packaged, true);
    assert.ok(page.url().startsWith('file:') && page.url().includes('app.asar/web/dist/index.html'));
    report.rendererUrl = page.url();
    report.keyStatus = await page.evaluate(() => window.electronAPI.getUpdateKeyStatus());
    assert.equal(report.keyStatus.valid, true);
    await page.getByTestId('login-phone-input').fill(user.phone);
    await page.getByTestId('login-password-input').fill('isolated-only');
    await page.getByTestId('login-submit-btn').click();
    await page.getByTestId('conv-item-legacy-chat').click();
    await page.getByText(message.content, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, '01-installed-old-authenticated-chat.png') });
    await page.waitForTimeout(2000);
    const before = await cache(page);
    assert.ok(JSON.stringify(before).includes(message.content));
    report.localTokenPresent = await page.evaluate(expected => localStorage.getItem('touliao_electron_token') === expected, token);
    assert.equal(report.localTokenPresent, true);
    // Observe the installed main process's log without injecting/replacing any
    // updater implementation. The old release supports TOULIAO_LOG_LEVEL=info.
    const logs = await app.evaluate(({ app }) => app.getPath('logs'));
    const logfile = path.join(logs, 'main.log');
    const previousLog = fs.existsSync(logfile) ? fs.readFileSync(logfile, 'utf8') : '';
    await page.evaluate(() => window.electronAPI.checkUpdate());
    for (let i = 0; i < 45; i++) {
      report.nativeUpdateLog = fs.existsSync(logfile) ? fs.readFileSync(logfile, 'utf8').slice(previousLog.length) : '';
      if (report.nativeUpdateLog.includes('已是最新版本')) break;
      await page.waitForTimeout(1000);
    }
    assert.ok(report.nativeUpdateLog.includes('已是最新版本'), 'Installed updater must report the current public version');
    fs.copyFileSync(logfile, path.join(out, 'installed-main.log'));
    await app.close(); active = null;
    active = await launch(); ({ app, page } = active);
    await page.getByTestId('conv-item-legacy-chat').waitFor();
    assert.equal(await page.evaluate(expected => localStorage.getItem('touliao_electron_token') === expected, token), true);
    assert.ok(JSON.stringify(await cache(page)).includes(message.content));
    await page.getByTestId('conv-item-legacy-chat').click();
    await page.getByText(message.content, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, '02-old-restart-session-cache-retained.png') });
    assert.equal(loginCount, 1);
    report.sameVersionRestartPreservedIsolatedSessionAndCache = true;
    report.loginCount = loginCount;
    report.passed = true;
  } catch (e) {
    report.error = e.stack;
    if (active) { try { await active.page.screenshot({ path: path.join(out, 'failure.png') }); } catch {} }
    process.exitCode = 1;
  } finally {
    if (active) { try { await active.app.close(); } catch {} }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
  }
})();
