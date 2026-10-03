'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-window-smoke-'));
  const appDir = path.join(temp, 'desktop');
  if (!process.env.TOULIAO_PACKAGED_APP) {
    fs.mkdirSync(appDir);
    for (const name of ['src', 'assets', 'package.json']) {
      fs.cpSync(path.join(root, name), path.join(appDir, name), { recursive: true });
    }
    fs.cpSync(process.env.TOULIAO_DESKTOP_WEB || path.join(root, '../web/dist'), path.join(temp, 'web/dist'), { recursive: true });
    fs.symlinkSync(process.env.TOULIAO_DESKTOP_MODULES || path.join(root, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');
  }
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(temp, 'config') };
  delete env.ELECTRON_RUN_AS_NODE;
  const apps = [];
  const nativeUpdateFeedback = process.platform === 'win32' && Boolean(process.env.TOULIAO_PACKAGED_APP);
  const updateEvidence = path.resolve(root, '../artifacts/windows-update-feedback');
  fs.mkdirSync(updateEvidence, { recursive: true });
  // extra：托盘「新开账号窗口」等价的 --new-account-window；Windows 普通启动也自动分配。
  const launch = async (extra = []) => {
    const app = await electron.launch({
      executablePath: process.env.TOULIAO_ELECTRON,
      args: [...(process.env.TOULIAO_PACKAGED_APP ? [] : [appDir]), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...extra], env,
    });
    apps.push(app);
    // 未登录的新 profile 查 /auth/me、/auth/refresh 必然 401：在本地直接应答同样的 401，
    // 不再打到生产（否则每次 CI 在线上留下成批 401，污染监控）。配置/更新源仍走真实服务。
    await app.context().route(/\/api\/auth\/(me|refresh)(\?|$)/, route => route.fulfill({
      status: 401, contentType: 'application/json', body: JSON.stringify({ error: '未授权' }),
    }));
    app.process().stdout?.on('data', data => process.stdout.write(data));
    app.process().stderr?.on('data', data => process.stderr.write(data));
    app.process().on('exit', (code, signal) => console.log('Electron process exited:', { code, signal }));
    // Fresh profiles use real config/unauthenticated APIs, without creating server accounts.
    const page = await app.firstWindow();
    const responses = [];
    page.on('response', response => {
      if (response.url().includes('/api/')) responses.push({ url: response.url(), status: response.status() });
    });
    page.on('pageerror', error => console.error('Renderer error:', error));
    await page.reload();
    try {
      await page.locator('#login-phone').waitFor({ timeout: 30000 });
    } catch (error) {
      const screenshot = path.join(temp, `failure-${apps.indexOf(app)}.png`);
      await page.screenshot({ path: screenshot });
      console.error('Login did not load:', { url: page.url(), screenshot, responses, text: await page.locator('body').innerText() });
      throw error;
    }
    await page.waitForFunction(() => {
      const image = document.querySelector('.auth-brand img');
      return image?.complete && image.naturalWidth > 0;
    });
    const state = await app.evaluate(({ app }) => ({
      userData: app.getPath('userData'), sessionData: app.getPath('sessionData'),
      version: app.getVersion(), packaged: app.isPackaged, electron: process.versions.electron,
    }));
    assert.equal(state.userData, state.sessionData);
    assert.equal(state.packaged, Boolean(process.env.TOULIAO_PACKAGED_APP));
    if (process.platform === 'win32') {
      await page.waitForFunction(() => document.documentElement.classList.contains('windows-desktop'));
      assert.equal(await page.evaluate(() => window.__ELECTRON_CONFIG__.platform), 'win32');
      // 登录页没有“新窗口登录”按钮；桌面图标和托盘均可多开。
      assert.equal(await page.getByText('在新窗口登录其他账号').count(), 0);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 600));
      await page.waitForFunction(() => innerWidth === 900 && innerHeight === 600);
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.getByTestId('login-switch-server-toggle').evaluate(button => ({
        bottom: button.getBoundingClientRect().bottom,
        height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
        stylesheet: [...document.styleSheets].some(sheet => sheet.href?.includes('windows-desktop')),
      }));
      assert.equal(layout.stylesheet, true, 'packaged Windows stylesheet loaded');
      assert.equal(layout.overflow, false, 'minimum Windows window does not overflow');
      assert.ok(layout.bottom <= layout.height, 'login actions fit minimum Windows window');
      await page.screenshot({ path: path.join(temp, `windows-login-${apps.indexOf(app)}.png`) });
    }
    return { app, page, state };
  };
  try {
    const one = await launch();
    if (nativeUpdateFeedback) {
    // Exercise real installed main/preload/renderer IPC against the existing update channel.
    // No update is installed and no signed metadata or production pointers are changed.
    await one.page.locator('.wc-update-check-btn').click();
    await one.page.getByText(`当前没有可用更新（当前版本 ${one.state.version}）`, { exact: true }).waitFor({ timeout: 60000 });
    await one.page.screenshot({ path: path.join(updateEvidence, 'no-update.png') });
    const notReady = await one.page.evaluate(async () => {
      try { await window.electronAPI.installUpdate(); return ''; }
      catch (error) { return error.message; }
    });
    assert.match(notReady, /下载完成/, 'unprepared install reports a reason without quitting');
    }
    await one.page.evaluate(() => localStorage.setItem('smoke_account', '1'));
    await one.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    // Concurrent tray new-window launches exercise the same allocation path as the tray menu.
    const newWindow = ['--new-account-window'];
    const raced = await Promise.allSettled([launch(newWindow), launch(newWindow)]);
    for (const result of raced) if (result.status === 'rejected') throw result.reason;
    const windows = [one, ...raced.map(result => result.value)];
    for (let i = 4; i <= 6; i++) windows.push(await launch(newWindow));
    const paths = windows.map(window => window.state.userData);
    assert.deepEqual([...paths].sort(), [one.state.userData, ...[2, 3, 4, 5, 6].map(profile =>
      path.join(one.state.userData, 'profiles', String(profile)))].sort());
    assert.equal(await one.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    for (const window of windows.slice(1)) {
      assert.equal(await window.page.evaluate(() => localStorage.getItem('smoke_account')), null);
      await window.page.evaluate(value => localStorage.setItem('smoke_account', value), path.basename(window.state.userData));
    }
    for (const window of windows) {
      const expected = window === one ? '1' : path.basename(window.state.userData);
      assert.equal(await window.page.evaluate(() => localStorage.getItem('smoke_account')), expected);
    }
    const two = windows.find(window => window.state.userData === path.join(one.state.userData, 'profiles', '2'));
    if (nativeUpdateFeedback) {
    await two.page.locator('.wc-update-check-btn').click();
    await two.page.getByText('请在账号窗口 1 检查更新，安装前退出其他账号窗口。', { exact: true }).waitFor();
    await two.page.screenshot({ path: path.join(updateEvidence, 'secondary-profile.png') });
    const secondaryInstall = await two.page.evaluate(async () => {
      try { await window.electronAPI.installUpdate(); return ''; }
      catch (error) { return error.message; }
    });
    assert.match(secondaryInstall, /账号窗口 1/, 'secondary install is explicitly refused');
    }
    await two.page.screenshot({ path: path.join(temp, 'login-window-2.png') });
    await two.page.evaluate(() => localStorage.setItem('touliao_electron_token', 'stale-test-token'));
    if (process.platform === 'win32') {
      await two.app.evaluate(({ session }) => session.defaultSession.cookies.set({
        url: 'https://touliao.cc', name: 'touliao-smoke-auth', value: 'stale',
      }));
    }
    await two.app.close();
    apps.splice(apps.indexOf(two.app), 1);
    // Windows 用普通启动重开空出的账号 2；其他平台仍用托盘分配标记。
    // 两者都从 1 往后取第一个空闲 profile；Windows 普通新开必须清掉旧账号身份。
    const reopened = await launch(process.platform === 'win32' ? [] : newWindow);
    assert.equal(reopened.state.userData, two.state.userData);
    if (process.platform === 'win32') {
      assert.equal(await reopened.page.evaluate(() => localStorage.getItem('smoke_account')), null);
      assert.equal(await reopened.page.evaluate(() => localStorage.getItem('touliao_electron_token')), null);
      assert.deepEqual(await reopened.app.evaluate(({ session }) => session.defaultSession.cookies.get({
        url: 'https://touliao.cc', name: 'touliao-smoke-auth',
      })), []);
    } else {
      assert.equal(await reopened.page.evaluate(() => localStorage.getItem('smoke_account')), '2');
    }
    assert.equal(await one.page.evaluate(() => localStorage.getItem('smoke_account')), '1');
    if (nativeUpdateFeedback) fs.writeFileSync(path.join(updateEvidence, 'report.json'), JSON.stringify({
      sha: process.env.GITHUB_SHA || null, runtime: one.state, nativeHost: process.platform,
      installedApp: Boolean(process.env.TOULIAO_PACKAGED_APP), passed: true,
      checks: ['manual check completes with installed version', 'unprepared install refused',
        'secondary profile check explains refusal', 'secondary profile install explains refusal'],
      actualUpgradeInstalled: false,
    }, null, 2));
    console.log(JSON.stringify({ automaticWindows: 6, concurrentLaunches: true, existingWindowNotShown: true,
      isolated: true, reusedProfileStartsFresh: process.platform === 'win32', logoLoaded: true, runtime: one.state,
      paths, screenshot: path.join(temp, 'login-window-2.png') }));
  } finally {
    for (const app of apps.reverse()) await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
