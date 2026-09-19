'use strict';
// Actual installed 8.1.26 updater -> production feed -> installed 8.1.27.
// Account APIs are isolated; update traffic and the NSIS installer are real.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE);
assert.equal(process.platform, 'win32');
const out = path.resolve('windows-auto-evidence'); fs.mkdirSync(out, { recursive: true });
const exe = process.env.LEGACY_EXE;
const token = 'isolated-windows-auto-upgrade-token';
const user = { id: 'legacy-me', username: 'UpgradeProbe', phone: '13900000001' };
const message = { id: 'legacy-message', conversation_id: 'legacy-chat', sender_id: 'legacy-peer', senderName: 'LegacyPeer', type: 'text', content: 'LEGACY-CACHED-MESSAGE-MUST-SURVIVE', created_at: 1789747100 };
const conv = { id: 'legacy-chat', type: 'private', name: 'LegacyPeer', lastMessage: 'Open cached history', lastTime: 1789747200, otherUser: { id: 'legacy-peer', username: 'LegacyPeer' } };
const report = { environment: 'GitHub Windows native VM', physicalDevice: false, productionAccountTested: false,
  oldVersion: '8.1.26', targetVersion: '8.1.27', updateTraffic: 'unchanged production HTTPS endpoints',
  accountApiAndSocketTransport: 'isolated fixture; realtime business not tested', hotUpdate: false, passed: false };
let loginCount = 0, historyOffline = false, active, logFile;
function ps(script) { return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; ' + script], { encoding: 'utf8', timeout: 60000 }); }
function blockNetwork() {
  ps('Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json | Set-Content "$env:RUNNER_TEMP/touliao-firewall-before.json"; Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True; New-NetFirewallRule -DisplayName "TouliaoUpdaterAudit" -Direction Outbound -Program $env:LEGACY_EXE -Protocol TCP -RemotePort 443 -Action Block | Out-Null');
}
function unblockNetwork() { ps('Get-NetFirewallRule -DisplayName "TouliaoUpdaterAudit" -ErrorAction SilentlyContinue | Remove-NetFirewallRule; if (Test-Path "$env:RUNNER_TEMP/touliao-firewall-before.json") { Get-Content "$env:RUNNER_TEMP/touliao-firewall-before.json" | ConvertFrom-Json | ForEach-Object { Set-NetFirewallProfile -Profile $_.Name -Enabled $_.Enabled } }'); }
async function launch() {
  const app = await _electron.launch({ executablePath: exe, args: ['--profile=1'], timeout: 90000, env: { ...process.env, TOULIAO_LOG_LEVEL: 'info' } });
  await app.context().route('**/api/**', route => {
    const req = route.request(), p = new URL(req.url()).pathname;
    let status = 200, body = {};
    if (p === '/api/auth/login') { loginCount++; body = { token, user }; }
    else if (p === '/api/auth/me') { status = req.headers()['authorization'] === 'Bearer ' + token ? 200 : 401; body = status === 200 ? user : {}; }
    else if (p === '/api/auth/refresh') status = 401;
    else if (p === '/api/config') body = { features: { loginCaptcha: false } };
    else if (p === '/api/csrf') body = { csrfToken: 'isolated-only' };
    else if (p === '/api/messages/conversations') body = [conv];
    else if (p === '/api/messages/legacy-chat') { status = historyOffline ? 503 : 200; body = historyOffline ? { error: 'History deliberately offline' } : [message]; }
    else if (p.endsWith('/sync')) { status = historyOffline ? 503 : 200; body = historyOffline ? {} : { messages: [message], cursor: 1, hasMore: false }; }
    else if (p.endsWith('/read-states')) body = { states: {} };
    else if (/contacts|pinned-messages|friend-requests|my-groups|friend-labels|blocked|collections|moments|call-logs|sessions/.test(p)) body = [];
    return route.fulfill({ status, json: body });
  });
  // Only the isolated account's transport handshake is simulated. Keeping it
  // connected avoids an unrelated, permanently reconnecting account banner
  // covering the historical update buttons. No message/call success is faked.
  await app.context().routeWebSocket(/.*/, ws => {
    ws.send('0' + JSON.stringify({ sid: 'isolated-upgrade', upgrades: [], pingInterval: 600000, pingTimeout: 600000 }));
    ws.onMessage(data => {
      if (String(data).startsWith('40')) ws.send('40' + JSON.stringify({ sid: 'isolated-upgrade' }));
      if (data === '2') ws.send('3');
    });
  });
  const page = await app.firstWindow(); await page.reload();
  return { app, page };
}
async function cached(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('touliao', 2); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, read = db.transaction('msgcache_v1').objectStore('msgcache_v1').getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => reject(read.error); };
  }));
}
async function waitFor(check, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 1000)); }
  throw Error('Timed out waiting for native upgrade state');
}
(async () => {
  try {
    blockNetwork();
    active = await launch(); let { app, page } = active;
    report.before = await app.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData'), appPath: app.getAppPath() }));
    assert.equal(report.before.version, '8.1.26');
    logFile = path.join(await app.evaluate(({ app }) => app.getPath('logs')), 'main.log');
    await page.getByTestId('login-phone-input').fill(user.phone);
    await page.getByTestId('login-password-input').fill('isolated-only');
    await page.getByTestId('login-submit-btn').click();
    await page.getByTestId('conv-item-legacy-chat').click();
    await page.getByText(message.content, { exact: true }).waitFor();
    await page.waitForTimeout(2000);
    assert.ok(JSON.stringify(await cached(page)).includes(message.content));
    await page.screenshot({ path: path.join(out, '01-old-installed-session-and-cache.png') });
    await page.evaluate(() => { window.__updateAuditErrors = []; window.addEventListener('electron:update-error', e => window.__updateAuditErrors.push(String(e.detail))); });
    await page.locator('.wc-update-check-btn, .wc-update-banner .wc-update-install-btn').first().click({ timeout: 120000 });
    await waitFor(() => page.evaluate(() => window.__updateAuditErrors.length > 0), 150000);
    report.failedCheckObserved = await page.evaluate(() => window.__updateAuditErrors);
    await page.screenshot({ path: path.join(out, '02-real-network-check-failure.png') });
    unblockNetwork();
    // Use the unchanged check IPC, so the startup timer cannot replace Retry
    // with Install midway through a locator click and install before inspection.
    await page.evaluate(() => window.electronAPI.checkUpdate());
    report.recoveryTrigger = 'historical checkUpdate IPC after removing the OS network block';
    await waitFor(() => page.locator('.wc-update-banner').innerText().then(t => /重启.*安装/.test(t)), 240000);
    await page.screenshot({ path: path.join(out, '03-production-update-downloaded-and-verified.png') });
    const log = fs.readFileSync(logFile, 'utf8');
    assert.ok(log.includes('8.1.27') && log.includes('元数据签名校验通过'));
    const pending = path.join(process.env.LOCALAPPDATA, 'touliao-desktop-updater', 'pending');
    const candidates = fs.readdirSync(pending).filter(n => n.endsWith('.exe'));
    assert.equal(candidates.length, 1);
    report.downloadedInstallerSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(pending, candidates[0]))).digest('hex');
    assert.equal(report.downloadedInstallerSha256, 'c2ae64ec1316d5f033b9f2afa25b3eb5bfbf56f978d8abe99b20b21c2cbcf7e0');
    report.signedManifestAndDownloadedBytesVerified = true;
    // Keep the auto-restarted app from sending the isolated account token to a
    // real account endpoint before the test driver reattaches. Updates are fully
    // downloaded and verified already; this does not bypass updater logic.
    blockNetwork();
    const closed = app.waitForEvent('close', { timeout: 120000 });
    await page.locator('.wc-update-install-btn').click().catch(e => { if (!/closed/i.test(e.message)) throw e; });
    await closed; active = null;
    // quitAndInstall() in the historical client uses the assisted NSIS wizard.
    // Drive that actual wizard instead of substituting a silent/manual installer.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive',
      '-File', path.resolve('scripts/legacy-update/drive-nsis-upgrade.ps1'), '-Output', out],
      { encoding: 'utf8', timeout: 210000 });
    await waitFor(() => {
      try { return ps('(Get-Item $env:LEGACY_EXE).VersionInfo.ProductVersion').trim().startsWith('8.1.27'); } catch { return false; }
    }, 150000);
    await new Promise(r => setTimeout(r, 5000));
    ps('Get-Process touliao -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:LEGACY_EXE } | Stop-Process -Force; exit 0');
    historyOffline = true;
    active = await launch(); ({ app, page } = active);
    report.after = await app.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData'), appPath: app.getAppPath() }));
    assert.equal(report.after.version, '8.1.27'); assert.equal(report.after.userData, report.before.userData);
    assert.equal(report.after.appPath, report.before.appPath);
    await page.getByTestId('conv-item-legacy-chat').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('touliao_electron_token')), token);
    assert.ok(JSON.stringify(await cached(page)).includes(message.content));
    await page.getByTestId('conv-item-legacy-chat').click(); await page.getByText(message.content, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, '04-new-ui-old-session-offline-history.png') });
    assert.equal(loginCount, 1);
    report.accountSessionAndOfflineHistoryPreserved = true; report.loginCount = loginCount;
    report.installedThroughHistoricalUpdater = true; report.failedNetworkCheckRecovered = true; report.passed = true;
  } catch (error) {
    report.error = error.stack; process.exitCode = 1;
    if (active) { try { await active.page.screenshot({ path: path.join(out, 'failure.png') }); } catch {} }
  } finally {
    if (active) { try { await active.app.close(); } catch {} }
    try { unblockNetwork(); } catch (error) { report.firewallCleanupError = error.message; process.exitCode = 1; }
    if (logFile && fs.existsSync(logFile)) fs.copyFileSync(logFile, path.join(out, 'installed-updater-main.log'));
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
  }
})();
