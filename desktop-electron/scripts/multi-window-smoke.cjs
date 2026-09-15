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
  fs.mkdirSync(appDir);
  for (const name of ['src', 'assets', 'package.json']) {
    fs.cpSync(path.join(root, name), path.join(appDir, name), { recursive: true });
  }
  fs.cpSync(process.env.TOULIAO_DESKTOP_WEB || path.join(root, '../web/dist'), path.join(temp, 'web/dist'), { recursive: true });
  fs.symlinkSync(process.env.TOULIAO_DESKTOP_MODULES || path.join(root, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(temp, 'config') };
  delete env.ELECTRON_RUN_AS_NODE;
  const apps = [];
  const launch = async profile => {
    const app = await electron.launch({
      executablePath: process.env.TOULIAO_ELECTRON,
      args: [appDir, `--profile=${profile}`, '--no-sandbox'], env,
    });
    apps.push(app);
    await app.context().route('https://**/*', route => {
      const url = route.request().url();
      if (url.endsWith('/config.json')) return route.fulfill({ json: { api: 'https://touliao.cc', socket: 'https://touliao.cc' } });
      if (url.includes('/api/config')) return route.fulfill({ json: { features: {} } });
      return route.fulfill({ status: 401, json: { error: 'test unauthenticated' } });
    });
    const page = await app.firstWindow();
    await page.reload();
    await page.locator('#login-phone').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const image = document.querySelector('.auth-brand img');
      return image?.complete && image.naturalWidth > 0;
    });
    return { app, page };
  };
  try {
    const one = await launch(1);
    await one.page.evaluate(() => localStorage.setItem('smoke_account', 'A'));
    const two = await launch(2);
    assert.equal(await two.page.evaluate(() => localStorage.getItem('smoke_account')), null);
    await two.page.evaluate(() => localStorage.setItem('smoke_account', 'B'));
    assert.equal(await one.page.evaluate(() => localStorage.getItem('smoke_account')), 'A');
    const paths = await Promise.all([one.app, two.app].map(app => app.evaluate(({ app }) => app.getPath('userData'))));
    assert.notEqual(paths[0], paths[1]);
    await two.page.screenshot({ path: path.join(temp, 'login-window-2.png') });
    await two.app.close();
    apps.splice(apps.indexOf(two.app), 1);
    const reopened = await launch(2);
    assert.equal(await reopened.page.evaluate(() => localStorage.getItem('smoke_account')), 'B');
    console.log(JSON.stringify({ isolated: true, profilePersists: true, logoLoaded: true, paths, screenshot: path.join(temp, 'login-window-2.png') }));
  } finally {
    for (const app of apps.reverse()) await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
