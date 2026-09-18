'use strict';
// Run against a desktop build. APIs and Electron IPC are fixtures, never production.
// PLAYWRIGHT_MODULE and CHROMIUM_PATH optionally select an installed browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../desktop-electron/node_modules/playwright');
const root = path.resolve(process.env.UI_BUILD || path.join(__dirname, '../web/dist'));
const output = path.resolve(process.env.UI_OUTPUT || '/tmp/touliao-windows-ui');
const now = Math.floor(Date.now() / 1000);
const user = { id: 'ui-me', username: '界面体验', wechat_id: 'ui-review', phone: '13800000000' };
const names = ['林晓', '产品讨论组', '陈远', '设计讨论组', '周可', '文件传输助手', '项目协作组', '许宁'];
const conversations = names.map((name, i) => ({
  id: `ui-${i}`, name, type: name.includes('组') ? 'group' : 'private',
  lastMessage: ['好的，我们下午三点再确认。', '新版方案已更新，大家看一下。', '资料已经整理好了。'][i % 3],
  lastTime: now - i * 900, lastMessageType: 'text', pinned: i === 0,
  otherUser: { id: `peer-${i}`, username: name },
  members: [{ id: 'peer-0', username: '林晓' }, { id: 'peer-1', username: '陈远' }, user],
}));
const messages = ['早上好，今天的讨论资料准备好了。', '我看过了，信息比较完整。', '有两个细节想再确认一下：\n1. 首页的信息层级\n2. 桌面端的阅读体验', '可以，我们下午一起看。', '我把需要调整的地方整理成清单，晚一点发给你。', '好的，我们下午三点再确认。'].map((content, i) => ({
  id: `msg-${i}`, conversation_id: 'ui-0', sender_id: i % 2 ? user.id : 'peer-0',
  senderName: i % 2 ? user.username : '林晓', type: 'text', content, created_at: now - 1200 + i * 120,
}));
const report = { fixture: true, nativeWindowsExecuted: false, cases: [] };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
  fs.createReadStream(filename).pipe(res);
});
async function fixture(browser, base, { platform = 'win32', width = 1200, height = 800, skin = 'aurora', theme = 'light', authenticated = true, font = 'normal', onSocketEvent, messageReply } = {}) {
  const sockets = new Set();
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  await context.addInitScript(({ platform, base, skin, theme, font }) => {
    localStorage.setItem('wc_skin', skin);
    localStorage.setItem('wc_theme', theme);
    localStorage.setItem('wc_font', font);
    if (platform !== 'web' && !window.__ELECTRON_CONFIG__) {
      window.__ELECTRON_CONFIG__ = { isElectron: true, platform, serverUrl: base, appVersion: '8.1.24', profile: 1 };
      window.__uiIPC = [];
      window.electronAPI = Object.fromEntries(['minimize', 'maximize', 'close', 'setBadge', 'showNotification', 'flashFrame', 'checkUpdate', 'newAccountWindow'].map(name => [name, async (...args) => { window.__uiIPC.push({ name, args }); }]));
      window.electronAPI.isMaximized = async () => false;
      window.electronAPI.getUpdateKeyStatus = async () => ({ valid: true });
    }
  }, { platform, base, skin, theme, font });
  await context.routeWebSocket(/.*/, ws => {
    sockets.add(ws);
    ws.send('0' + JSON.stringify({ sid: 'ui-review', upgrades: [], pingInterval: 60000, pingTimeout: 60000 }));
    ws.onMessage(data => {
      if (String(data).startsWith('40')) ws.send('40' + JSON.stringify({ sid: 'ui-review' }));
      if (data === '2') ws.send('3');
      const packet = String(data).match(/^42(\d*)(\[.*)$/);
      if (packet) {
        const [event, payload] = JSON.parse(packet[2]);
        onSocketEvent?.(event, payload);
        if (event === 'send_message' && packet[1]) ws.send('43' + packet[1] + JSON.stringify([messageReply ? messageReply(payload) : {
          success: true,
          message: { id: 'fixture-sent', conversation_id: payload.conversationId, sender_id: user.id, senderName: user.username, content: payload.content, type: 'text', created_at: now + 1, seq: 100 },
        }]));
      }
    });
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url()), p = url.pathname;
    if (p.endsWith('/config.json')) return route.fulfill({ json: { api: base, socket: base, cdn: base } });
    if (p.startsWith('/api/')) {
      let body = {};
      if (p === '/api/auth/me') return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? user : { error: 'fixture logged out' } });
      if (p === '/api/auth/refresh') return route.fulfill({ status: 401, json: {} });
      if (p === '/api/config') body = { features: {} };
      else if (p === '/api/messages/conversations') body = conversations;
      else if (p === '/api/messages/unread-counts') body = { 'ui-0': 2, 'ui-1': 8 };
      else if (p === '/api/users/contacts') body = names.map((username, i) => ({ id: `peer-${i}`, username }));
      else if (p === '/api/messages/ui-0') body = messages;
      else if (p === '/api/messages/ui-1') body = messages.map(m => ({ ...m, conversation_id: 'ui-1' }));
      else if (p === '/api/users/peer-0') body = { id: 'peer-0', username: '林晓' };
      else if (p === '/api/messages/file-helper') body = { conversationId: 'ui-5' };
      else if (p.endsWith('/info')) body = { members: conversations[1].members, name: '产品讨论组', settings: {} };
      else if (p.endsWith('/pinned-messages') || /friend-requests|my-groups|friend-labels|blocked|collections|moments|call-logs|auth\/sessions/.test(p)) body = [];
      else if (p.endsWith('/csrf')) body = { csrfToken: 'ui-only' };
      return route.fulfill({ json: body });
    }
    if ((url.origin !== base && url.protocol !== 'file:') || !['GET', 'HEAD'].includes(route.request().method())) return route.abort();
    return route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await (authenticated ? page.getByTestId('nav-tab-chats') : page.getByTestId('login-phone-input')).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors, emitSocket: (event, payload) => { for (const ws of sockets) ws.send('42' + JSON.stringify([event, payload])); } };
}
async function capture(page, name, errors) {
  await page.waitForTimeout(160);
  const metrics = await page.evaluate(() => {
    const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    const rows = [...document.querySelectorAll('[data-testid^="conv-item-ui-"]')].map(box);
    const visible = e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
    return {
      windows: document.documentElement.classList.contains('windows-desktop'),
      overflow: document.documentElement.scrollWidth > innerWidth,
      horizontalScrollers: [...document.querySelectorAll('.wc-list *')].filter(e => e.clientWidth > 0 && e.scrollWidth > e.clientWidth && ['auto','scroll'].includes(getComputedStyle(e).overflowX)).length,
      rows,
      brokenImages: [...document.images].filter(e => visible(e) && (!e.complete || !e.naturalWidth)).length,
      app: document.querySelector('.wc-app') ? box(document.querySelector('.wc-app')) : null,
      input: document.querySelector('.wc-input-area') ? box(document.querySelector('.wc-input-area')) : null,
      profile: document.querySelector('.wc-me-header') ? box(document.querySelector('.wc-me-header')) : null,
    };
  });
  assert.deepEqual(errors, [], name + ': no runtime errors');
  assert.equal(metrics.overflow, false, name + ': no horizontal overflow');
  assert.equal(metrics.brokenImages, 0, name + ': images loaded');
  if (metrics.windows) {
    assert.equal(metrics.horizontalScrollers, 0, name + ': conversation hover must not create a horizontal scrollbar');
    for (let i = 0; i < metrics.rows.length; i++) {
      assert.equal(metrics.rows[i].height, require('../web/src/ui-kit/tokens.json').components.listRow.desktopMinimum, name + ': virtual row agrees with rendered row');
      if (i) assert.ok(metrics.rows[i - 1].bottom <= metrics.rows[i].y + .5, name + ': adjacent rows do not overlap');
    }
    if (metrics.app) {
      assert.equal(metrics.app.y, 30, name + ': content below native titlebar');
      assert.ok(metrics.app.bottom <= page.viewportSize().height, name + ': bottom controls remain inside window');
    }
  }
  await page.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled' });
  report.cases.push({ name, ...metrics });
  console.log('PASS', name);
}
async function run() {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    for (const [width, height] of [[1200, 800], [900, 600], [1440, 900]]) {
      const { context, page, errors } = await fixture(browser, base, { width, height });
      await page.getByTestId('conv-item-ui-0').waitFor();
      await capture(page, `home-${width}`, errors);
      await page.getByTestId('conv-item-ui-0').click();
      await page.locator('.wc-msg-bubble').first().waitFor();
      await capture(page, `chat-${width}`, errors);
      const input = page.getByPlaceholder('输入消息…');
      await input.fill('检查窗口缩放时保留的草稿');
      await page.setViewportSize({ width: 1000, height: 700 });
      assert.equal(await input.inputValue(), '检查窗口缩放时保留的草稿');
      await page.setViewportSize({ width, height });
      await input.fill('');
      await page.getByTestId('chat-search-btn').click();
      await capture(page, `chat-search-${width}`, errors);
      await page.getByTestId('chat-search-btn').click();
      await input.fill('窗口界面回归测试');
      await page.getByTestId('chat-send-btn').click();
      await page.getByTestId('msg-bubble-fixture-sent').waitFor();
      assert.equal(await input.inputValue(), '', 'successful send clears composer');
      await page.getByTestId('conv-item-ui-1').click();
      await page.locator('.wc-msg-bubble').first().waitFor();
      await capture(page, `group-${width}`, errors);
      await page.getByTestId('nav-tab-contacts').click();
      await page.getByText('新的朋友', { exact: true }).waitFor();
      await capture(page, `contacts-${width}`, errors);
      await page.getByTestId('nav-tab-me').click();
      await page.locator('.wc-me-header').waitFor();
      await capture(page, `profile-${width}`, errors);
      assert.ok((await page.locator('.wc-me-header').boundingBox()).width > 500, 'settings use main workspace');
      await page.getByText('外观', { exact: true }).click();
      await page.locator('.wc-appearance-btn').first().waitFor();
      await capture(page, `appearance-${width}`, errors);
      await page.getByText('夜间模式', { exact: true }).click();
      await page.waitForFunction(() => document.body.classList.contains('dark-mode'));
      await page.getByText('日间模式', { exact: true }).click();
      await page.waitForFunction(() => !document.body.classList.contains('dark-mode'));
      await page.getByText('特大', { exact: true }).click();
      await page.getByTestId('nav-tab-chats').click();
      await page.getByTestId('conv-item-ui-0').click();
      await page.locator('.wc-msg-bubble').first().waitFor();
      await capture(page, `large-font-${width}`, errors);
      await context.close();
    }
    for (const skin of ['aurora', 'wechat', 'wecom']) for (const theme of ['light', 'dark']) {
      const { context, page, errors } = await fixture(browser, base, { skin, theme });
      await page.getByTestId('conv-item-ui-0').click();
      await page.locator('.wc-msg-bubble').first().waitFor();
      await capture(page, `chat-${skin}-${theme}`, errors);
      const gradient = await page.locator('.wc-msg-bubble.mine').first().evaluate(e => getComputedStyle(e).backgroundImage);
      assert.equal(gradient, 'none', 'Windows message bubbles avoid gradients in all skins');
      await context.close();
    }
    for (const [width, height] of [[1200, 800], [900, 600]]) {
      const { context, page, errors } = await fixture(browser, base, { width, height, authenticated: false });
      await capture(page, `login-${width}`, errors);
      const serverAction = await page.getByTestId('login-switch-server-toggle').boundingBox();
      assert.ok(serverAction.y + serverAction.height <= height, 'default login actions fit minimum window');
      assert.equal(await page.locator('.windows-account-entry button').count(), 1, 'secondary account action remains available');
      await page.getByTestId('login-phone-input').fill('13800000000');
      await page.getByTestId('login-password-input').fill('fixture-only');
      assert.equal(await page.getByTestId('login-submit-btn').isEnabled(), true);
      await page.getByTestId('login-switch-server-toggle').click();
      await capture(page, `login-server-${width}`, errors);
      await page.locator('.auth-server-cancel').scrollIntoViewIfNeeded();
      const cancel = await page.locator('.auth-server-cancel').boundingBox();
      assert.ok(cancel.y >= 30 && cancel.y + cancel.height <= height, 'expanded server form can scroll to last action');
      await page.locator('#touliao-titlebar button').first().click();
      assert.ok(await page.evaluate(() => __uiIPC.some(call => call.name === 'minimize')));
      await context.close();
    }
    for (const platform of ['web', 'darwin', 'linux']) {
      const { context, page, errors } = await fixture(browser, base, { platform });
      await page.getByTestId('conv-item-ui-0').click();
      await page.locator('.wc-msg-bubble').first().waitFor();
      await capture(page, `unchanged-${platform}`, errors);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('windows-desktop')), false);
      assert.equal(await page.locator('link[href*="windows-desktop"]').count(), 0, 'Windows stylesheet is not loaded on other platforms');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
    fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
if (require.main === module) run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
module.exports = { fixture, capture };
