'use strict';
// Run against a disposable database and a prebuilt web directory, never production.
const assert = require('node:assert/strict');
const legalConsent = require('../backend-v2/test/legal-consent.cjs');
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
const webpush = require('../backend-v2/node_modules/web-push');
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
// The external push gateway is a fixture; browser worker registration/routing is real.
webpush.sendNotification = async () => ({});
// Prevent dotenv from loading deployment secrets and external integration endpoints.
process.chdir(temp);
const app = require('../backend-v2/src/app');
const setupRealtime = require('../backend-v2/src/realtime');
const web = path.resolve(process.env.TOULIAO_WEB_BUILD || path.join(__dirname, '../web/dist'));
const site = express();
if (process.env.TOULIAO_LEGACY_SW) {
  site.get('/sw.js', (_req, res) => res.sendFile(path.resolve(process.env.TOULIAO_LEGACY_SW)));
}
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
        body: JSON.stringify({...credentials,legalConsent}),
      });
      assert.equal(response.status, 200);
      const registered = await response.json();
      users.push({ ...credentials, ...registered.user, token: registered.token });
    }
    const api = async (user, method, url, body) => {
      const response = await fetch(`${base}${url}`, { method,
        headers: { Authorization: `Bearer ${user.token}`, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      });
      assert.equal(response.status, 200, `${method} ${url}`);
      return response.json();
    };
    await api(users[0], 'POST', '/api/users/friend-request', { toId: users[1].id });
    const requests = await api(users[1], 'GET', '/api/users/friend-requests');
    await api(users[1], 'POST', `/api/users/friend-request/${requests[0].id}/handle`, { action: 'accept' });
    const { conversationId } = await api(users[0], 'POST', '/api/messages/conversation/private', { userId: users[1].id });
    const avatar = new FormData();
    const avatarBytes = await require('../backend-v2/node_modules/sharp')({ create: { width: 32, height: 32, channels: 3, background: '#29a87d' } }).png().toBuffer();
    avatar.append('avatar', new Blob([avatarBytes], { type: 'image/png' }), 'avatar.png');
    const refusedAvatar = await fetch(`${base}/api/users/avatar`, {
      method:'POST',headers:{Authorization:`Bearer ${users[1].token}`},body:avatar,
    });
    assert.equal(refusedAvatar.status,503);
    assert.equal((await refusedAvatar.json()).error_code,'MEDIA_MODERATION_UNAVAILABLE');
    // Seed only synthetic pre-existing media to keep the historical access regression.
    const {db:legacyDb}=require('../backend-v2/src/db/connection');
    const avatarPath=path.join(process.env.UPLOADS_ROOT,'avatars','synthetic-legacy.png');
    fs.mkdirSync(path.dirname(avatarPath),{recursive:true});fs.writeFileSync(avatarPath,avatarBytes);
    legacyDb.prepare('UPDATE users SET avatar=? WHERE id=?').run('/uploads/avatars/synthetic-legacy.png',users[1].id);
    browser = await chromium.launch({ headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'allow', permissions: ['notifications'] });
    await context.addInitScript(() => {
      const subscriptions = new Map();
      Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { get() {
        const scope = this.scope;
        return { getSubscription: async () => subscriptions.get(scope) || null,
          subscribe: async () => {
            const endpoint = `https://fcm.googleapis.com/fcm/send/smoke-${encodeURIComponent(scope)}`;
            const sub = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'fixture', auth: 'fixture' } }),
              unsubscribe: async () => { subscriptions.delete(scope); return true; } };
            subscriptions.set(scope, sub);
            return sub;
          } };
      } });
    });
    context.setDefaultTimeout(20000);
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
      await page.getByRole('checkbox', {name:'同意隐私政策和用户协议'}).check();
      await page.getByTestId('login-submit-btn').click();
      await page.getByTestId('account-switcher').waitFor({ timeout: 20000 });
      assert.equal((await identity(page)).id, users[i].id);
      if (i === 0) {
        await page.evaluate(async () => {
          await navigator.serviceWorker.register('/sw.js', { scope: '/' });
          await navigator.serviceWorker.ready;
          const cache = await caches.open('touliao-api-v1');
          await cache.put('/api/config', new Response(JSON.stringify({ features: {} }), {
            headers: { 'content-type': 'application/json', date: new Date().toUTCString() },
          }));
        });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      }
    }
    for (let i = 0; i < pages.length; i++) {
      await pages[i].reload();
      await pages[i].getByTestId('account-switcher').waitFor();
      assert.equal((await identity(pages[i])).id, users[i].id);
    }
    const connectedIds = new Set([...io.sockets.sockets.values()].map(socket => socket.user.id));
    assert.ok(users.every(user => connectedIds.has(user.id)), 'all three accounts have distinct connected sockets');
    const { db } = require('../backend-v2/src/db/connection');
    for (const page of pages) await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).filter(reg => new URL(reg.scope).pathname.startsWith('/push/')).length === 3);
    for (let i = 0; i < 100 && db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n < 3; i++) await new Promise(resolve => setTimeout(resolve, 50));
    const pushRows = db.prepare('SELECT user_id,endpoint,session_id FROM push_subscriptions').all();
    assert.equal(pushRows.length, 3, 'three distinct push subscriptions coexist');
    assert.equal(new Set(pushRows.map(row => row.endpoint)).size, 3);
    assert.ok(pushRows.every(row => row.session_id), 'subscriptions are session-bound');
    for (const page of pages.slice(0, 2)) await page.getByTestId(`conv-item-${conversationId}`).click();
    const avatarImage = pages[0].getByTestId(`conv-item-${conversationId}`).locator('img');
    await avatarImage.waitFor();
    await pages[0].waitForFunction(() => [...document.querySelectorAll('.wc-chat-item-avatar img')].some(img => img.complete && img.naturalWidth > 0));
    await pages[0].getByTestId('chat-msg-input').fill('launch audit hello');
    await pages[0].getByTestId('chat-send-btn').click();
    await pages[1].getByText('launch audit hello', { exact: true }).last().waitFor();
    await pages[1].getByTestId('chat-msg-input').fill('launch audit reply');
    await pages[1].getByTestId('chat-send-btn').click();
    await pages[0].getByText('launch audit reply', { exact: true }).last().waitFor();
    const XLSX = require('../web/node_modules/xlsx');
    assert.equal(XLSX.version, '0.20.3');
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Launch audit', 42], ['Safe cell', 'hello']]);
    sheet.A2.h = '<img src="x" onerror="window.__unsafeSheet=true">';
    XLSX.utils.book_append_sheet(workbook, sheet, 'First sheet');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Second sheet value']]), 'Second sheet');
    await pages[0].getByTestId('chat-attach-file').setInputFiles({ name: 'launch-audit.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
    });
    await pages[1].getByTestId('msg-file').filter({ hasText: 'launch-audit.xlsx' }).click();
    const preview = pages[1].getByTestId('file-preview');
    await preview.locator('.wc-xlsx-table-wrap').getByText('Launch audit', { exact: true }).waitFor();
    assert.equal(await preview.locator('[onerror],script').count(), 0);
    assert.equal(await pages[1].evaluate(() => !!window.__unsafeSheet), false);
    await preview.getByRole('button', { name: 'Second sheet', exact: true }).click();
    await preview.getByText('Second sheet value', { exact: true }).waitFor();
    await pages[1].setViewportSize({ width: 390, height: 844 });
    await preview.getByText('Second sheet value', { exact: true }).waitFor();
    await preview.getByRole('button', { name: 'First sheet', exact: true }).click();
    await preview.locator('.wc-xlsx-table-wrap').getByText('Launch audit', { exact: true }).waitFor();
    await preview.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    assert.ok(await preview.evaluate(el => el.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2))), 'preview is above the chat surface');
    await pages[1].screenshot({ path: path.join(temp, 'spreadsheet-mobile.png'), fullPage: true, animations: 'disabled' });
    assert.ok(await pages[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await pages[1].getByTestId('file-preview-close').click();
    await pages[1].setViewportSize({ width: 1280, height: 900 });
    await pages[0].screenshot({ path: path.join(temp, 'chat-desktop.png') });
    await pages[1].getByTestId('nav-tab-me').click();
    await pages[1].locator('.wc-logout-btn').click();
    await pages[1].getByTestId('login-phone-input').waitFor();
    assert.equal((await identity(pages[1])).status, 401);
    assert.equal((await identity(pages[0])).id, users[0].id);
    assert.equal((await identity(pages[2])).id, users[2].id);
    assert.deepEqual(db.prepare('SELECT user_id FROM push_subscriptions ORDER BY user_id').all().map(row => row.user_id), [users[0].id, users[2].id].sort());
    await pages[1].setViewportSize({ width: 390, height: 844 });
    await pages[1].screenshot({ path: path.join(temp, 'login-mobile.png'), fullPage: true });
    assert.ok(await pages[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await pages[2].screenshot({ path: path.join(temp, 'independent-account.png') });
    console.log(JSON.stringify({ independentAccounts: 3, csrfEnabled: true, sharedServiceWorker: true, isolatedPushRegistrations: 3, externalPushGatewayMocked: true, logoutIsolated: true, socketsIsolated: true, bidirectionalChat: true, avatarLoaded: true, spreadsheetPreview: true, previewSurvivesResize: true, screenshots: temp }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => io.close(resolve));
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
