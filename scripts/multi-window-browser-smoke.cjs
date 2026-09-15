'use strict';
// Run against a disposable database and a prebuilt web directory, never production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const express = require('express');
const { Server } = require('socket.io');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-browser-smoke-'));
require('../backend-v2/test/testEnv');
process.env.DB_PATH = path.join(temp, 'test.sqlite');
process.env.UPLOADS_ROOT = path.join(temp, 'uploads');
process.env.DISABLE_CSRF = '0';
process.env.REDIS_URL = '';
process.env.COOKIE_SECURE = 'false';
// Prevent dotenv from loading deployment secrets and external integration endpoints.
process.chdir(temp);
const app = require('../backend-v2/src/app');
const setupRealtime = require('../backend-v2/src/realtime');
const web = path.resolve(process.env.TOULIAO_WEB_BUILD || path.join(__dirname, '../web/dist'));
const site = express();
site.use(['/api', '/uploads'], (req, res, next) => {
  req.url = req.originalUrl;
  app(req, res, next);
});
site.use(express.static(web));
site.get('*', (_req, res) => res.sendFile(path.join(web, 'index.html')));
const server = http.createServer(site);
const io = new Server(server);
setupRealtime(io, app);

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    require('../backend-v2/src/config').allowedOrigins.push(base);
    const users = [];
    for (let i = 0; i < 3; i++) {
      const credentials = { phone: `1380000000${i}`, username: `window_${i}`, password: 'passw0rd123456', inviteCode: '123456' };
      const response = await fetch(`${base}/api/auth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'X-Touliao-Session': 'isolated' },
        body: JSON.stringify(credentials),
      });
      assert.equal(response.status, 200);
      users.push({ ...credentials, ...(await response.json()).user });
    }
    browser = await chromium.launch({ headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.route('https://**/*', route => route.request().url().includes('config.json')
      ? route.fulfill({ json: { api: base, socket: base, cdn: base, version: 'test' } })
      : route.abort());
    const pages = [];
    const identity = page => page.evaluate(async () => {
      const token = sessionStorage.getItem('touliao_electron_token');
      const headers = sessionStorage.getItem('touliao_account_window')
        ? { 'X-Touliao-Session': 'isolated', Authorization: `Bearer ${token}` } : {};
      const response = await fetch('/api/auth/me', { headers });
      return { status: response.status, id: (await response.json()).id };
    });
    for (let i = 0; i < users.length; i++) {
      const page = await context.newPage();
      pages.push(page);
      await page.goto(`${base}/login${i ? `?accountWindow=${randomUUID()}` : ''}`);
      await page.getByTestId('login-phone-input').fill(users[i].phone);
      await page.getByTestId('login-password-input').fill(users[i].password);
      await page.getByTestId('login-submit-btn').click();
      await page.getByTestId('account-switcher').waitFor({ timeout: 20000 });
      assert.equal((await identity(page)).id, users[i].id);
    }
    for (let i = 0; i < pages.length; i++) {
      await pages[i].reload();
      await pages[i].getByTestId('account-switcher').waitFor();
      assert.equal((await identity(pages[i])).id, users[i].id);
    }
    const connectedIds = new Set([...io.sockets.sockets.values()].map(socket => socket.user.id));
    assert.ok(users.every(user => connectedIds.has(user.id)), 'all three accounts have distinct connected sockets');
    await pages[1].getByTestId('nav-tab-me').click();
    await pages[1].locator('.wc-logout-btn').click();
    await pages[1].getByTestId('login-phone-input').waitFor();
    assert.equal((await identity(pages[1])).status, 401);
    assert.equal((await identity(pages[0])).id, users[0].id);
    assert.equal((await identity(pages[2])).id, users[2].id);
    await pages[1].setViewportSize({ width: 390, height: 844 });
    await pages[1].screenshot({ path: path.join(temp, 'login-mobile.png'), fullPage: true });
    assert.ok(await pages[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await pages[2].screenshot({ path: path.join(temp, 'independent-account.png') });
    console.log(JSON.stringify({ independentAccounts: 3, csrfEnabled: true, logoutIsolated: true, socketsIsolated: true, screenshots: temp }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => io.close(resolve));
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
