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
  const launch = async () => {
    const app = await electron.launch({
      executablePath: process.env.TOULIAO_ELECTRON,
      args: [...(process.env.TOULIAO_PACKAGED_APP ? [] : [appDir]), '--no-sandbox'], env,
    });
    apps.push(app);
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
    return { app, page, state };
  };
  try {
    const one = await launch();
    await one.page.evaluate(() => localStorage.setItem('smoke_account', '1'));
    await one.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    // Concurrent ordinary launches exercise the same no-profile path as desktop shortcuts.
    const raced = await Promise.allSettled([launch(), launch()]);
    for (const result of raced) if (result.status === 'rejected') throw result.reason;
    const windows = [one, ...raced.map(result => result.value)];
    for (let i = 4; i <= 6; i++) windows.push(await launch());
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
    await two.page.screenshot({ path: path.join(temp, 'login-window-2.png') });
    await two.app.close();
    apps.splice(apps.indexOf(two.app), 1);
    const reopened = await launch();
    assert.equal(reopened.state.userData, two.state.userData);
    assert.equal(await reopened.page.evaluate(() => localStorage.getItem('smoke_account')), '2');
    assert.equal(await one.page.evaluate(() => localStorage.getItem('smoke_account')), '1');
    console.log(JSON.stringify({ automaticWindows: 6, concurrentLaunches: true, existingWindowNotShown: true,
      isolated: true, profilePersists: true, logoLoaded: true, runtime: one.state,
      paths, screenshot: path.join(temp, 'login-window-2.png') }));
  } finally {
    for (const app of apps.reverse()) await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
