/* Local-only UI regression against an isolated, seeded backend.
 * UI_REVIEW_DIR must contain fixture.json ({base, users:[{phone,password,token,id}], conversationId}).
 * PLAYWRIGHT_MODULE / AXE_SCRIPT may point to separately installed test tooling.
 * The accompanying sandbox and invocation are retained in the review report.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.UI_REVIEW_DIR;
assert.ok(out, 'UI_REVIEW_DIR is required');
const f = JSON.parse(fs.readFileSync(path.join(out, 'fixture.json')));
assert.ok(['localhost', '127.0.0.1'].includes(new URL(f.base).hostname), 'Use an isolated local backend');
const results = [];
const stamp = Date.now();
let browser;
async function api(i, method, url, body) {
  const r = await fetch(f.base + url, { method, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + f.users[i].token }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json();
  assert.equal(r.status, 200, method + ' ' + url + ' ' + JSON.stringify(data));
  return data;
}
async function poll(fn, description) {
  for (let i = 0; i < 60; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 150)); }
  throw new Error('Timed out: ' + description);
}
async function context(options = {}) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await c.route('**/*', r => {
    const url = new URL(r.request().url());
    if (url.origin === f.base) return r.continue();
    if (url.pathname === '/config.json') return r.fulfill({ json: { api: f.base, socket: f.base, cdn: f.base } });
    return r.abort();
  });
  return c;
}
async function login(c, i = 0) {
  const p = await c.newPage(); p.setDefaultTimeout(10000);
  await p.goto(f.base + '/login');
  await p.getByTestId('login-phone-input').fill(f.users[i].phone);
  await p.getByTestId('login-password-input').fill(f.users[i].password);
  await p.getByRole('checkbox', { name: '同意隐私政策和用户协议' }).check();
  await p.getByTestId('login-submit-btn').click();
  await p.getByTestId('nav-tab-chats').waitFor();
  return p;
}
async function record(id, fn) {
  if (process.env.UI_REVIEW_FILTER && !new RegExp(process.env.UI_REVIEW_FILTER).test(id)) return;
  try { results.push({ id, outcome: 'pass', ...await fn() }); console.log('PASS', id); }
  catch (e) { results.push({ id, outcome: 'fail', error: e.stack }); console.error('FAIL', id, e.message); process.exitCode = 1; }
  fs.writeFileSync(path.join(out, process.env.UI_REVIEW_RESULT || 'browser-results.json'), JSON.stringify(results, null, 2));
}
async function moments(p) {
  await p.getByTestId('nav-tab-chats').click(); await p.getByTestId('nav-tab-moments').click();
  await poll(async () => !await p.locator('.moments-root .wc-moment-skeleton').count(), 'moment load');
}
(async () => {
  browser = await chromium.launch({ headless: true });
  try {
    const c = await context(); const p = await login(c);
    const pageErrors = []; p.on('pageerror', e => pageErrors.push(e.message));
    await record('F05-contacts-search-keyboard', async () => {
      await p.getByTestId('nav-tab-contacts').click();
      const input = p.getByRole('textbox', { name: '搜索', exact: true });
      await input.fill('审查'); await input.press('Space'); await input.press('X'); await input.press('Enter');
      assert.equal(await input.inputValue(), '审查 X'); await input.fill('');
      assert.equal(await p.getByRole('dialog').count(), 0);
    });
    await record('F08-settings-keyboard-isolated', async () => {
      await moments(p);
      let requests = 0;
      const observe = req => { if (/\/notifications\?/.test(req.url())) requests++; };
      p.on('request', observe);
      for (const key of ['Enter', 'Space']) {
        await p.getByRole('button', { name: '朋友圈设置', exact: true }).press(key);
        await p.getByRole('dialog', { name: '朋友圈设置', exact: true }).waitFor();
        assert.equal(await p.getByRole('dialog', { name: '互动消息', exact: true }).count(), 0);
        await p.keyboard.press('Escape');
      }
      p.off('request', observe); assert.equal(requests, 0);
    });
    await record('F02-privacy-save-failure-success-persistence', async () => {
      await api(0, 'PUT', '/api/users/me/settings', { momentsVisibleDays: 0 }); await moments(p);
      await p.getByRole('button', { name: '朋友圈设置', exact: true }).click();
      const dialog = p.getByRole('dialog', { name: '朋友圈设置', exact: true });
      await p.route('**/api/users/me/settings', r => r.request().method() === 'PUT' ? r.fulfill({ status: 500, json: { error: 'Injected save failure' } }) : r.continue());
      await dialog.getByRole('radio').filter({ hasText: '最近三天' }).click();
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.locator('[aria-checked="true"]').innerText(), /全部/);
      assert.equal((await api(0, 'GET', '/api/users/me/settings')).momentsVisibleDays, 0);
      await p.screenshot({ path: path.join(out, 'privacy-failure.png') });
      await p.unroute('**/api/users/me/settings');
      await dialog.getByRole('radio').filter({ hasText: '最近三天' }).click();
      await poll(async () => /三天/.test(await dialog.locator('[aria-checked="true"]').innerText()), 'privacy save');
      assert.equal((await api(0, 'GET', '/api/users/me/settings')).momentsVisibleDays, 3);
      await p.keyboard.press('Escape'); await moments(p);
      await p.getByRole('button', { name: '朋友圈设置', exact: true }).click();
      await poll(async () => /三天/.test(await dialog.locator('[aria-checked="true"]').innerText()), 'privacy persisted');
      await p.keyboard.press('Escape');
    });
    await record('F02-privacy-initial-fetch-failure', async () => {
      await p.route('**/api/users/me/settings', r => r.request().method() === 'GET' ? r.fulfill({ status: 503, json: {} }) : r.continue());
      await moments(p); await p.getByRole('button', { name: '朋友圈设置', exact: true }).click();
      const dialog = p.getByRole('dialog', { name: '朋友圈设置', exact: true });
      await dialog.getByRole('alert').waitFor();
      assert.equal(await dialog.locator('[aria-checked="true"]').count(), 0);
      assert.equal(await dialog.locator('button[role="radio"]:disabled').count(), 4);
      await p.unroute('**/api/users/me/settings'); await dialog.getByRole('button', { name: '重试', exact: true }).click();
      await poll(async () => await dialog.locator('[aria-checked="true"]').count() === 1, 'settings retry'); await p.keyboard.press('Escape');
    });
    await record('F03-timeline-load-more-retry', async () => {
      const prefix = '修复分页-' + stamp;
      for (let i = 0; i < 25; i++) await api(0, 'POST', '/api/moments', { content: prefix + '-' + i, visibility: 'private' });
      await moments(p); await poll(async () => await p.locator('.wc-moment-card').count() === 20, 'first page');
      await p.route('**/api/moments?*', r => new URL(r.request().url()).searchParams.has('beforeId') ? r.fulfill({ status: 500, json: {} }) : r.continue());
      await p.locator('.moments-pagination').getByRole('button', { name: '加载更多' }).click();
      await p.locator('.moments-pagination [role="alert"]').waitFor(); assert.equal(await p.locator('.wc-moment-card').count(), 20);
      await p.unroute('**/api/moments?*'); await p.locator('.moments-pagination').getByRole('button', { name: '重试' }).click();
      await poll(async () => await p.locator('.wc-moment-card').filter({ hasText: prefix }).count() === 25, 'all 25 posts');
      await p.screenshot({ path: path.join(out, 'timeline-desktop.png') });
      return { seededPosts: 25, visiblePosts: 25 };
    });
    await record('F01-notifications-pagination-and-read', async () => {
      const m = await api(0, 'POST', '/api/moments', { content: '通知回归-' + stamp, visibility: 'all' });
      for (let i = 0; i < 34; i++) await api(1 + (i % 2), 'POST', '/api/moments/' + m.id + '/comment', { content: '真实通知-' + i });
      await moments(p); assert.ok((await api(0, 'GET', '/api/moments/notifications/unread-count')).count >= 34);
      await p.getByRole('button', { name: /互动消息/ }).click();
      const dialog = p.getByRole('dialog', { name: '互动消息', exact: true });
      await poll(async () => await dialog.locator('.wc-moment-notif-item').count() === 30, 'first notifications');
      const total = (await api(0, 'GET', '/api/moments/notifications?limit=30')).total;
      while (await dialog.locator('.wc-moment-notif-item').count() < total) {
        const before = await dialog.locator('.wc-moment-notif-item').count();
        await dialog.getByRole('button', { name: '加载更多' }).click();
        await poll(async () => await dialog.locator('.wc-moment-notif-item').count() > before, 'next notifications page');
      }
      assert.equal(await dialog.locator('.wc-moment-notif-item').count(), total);
      await poll(async () => (await api(0, 'GET', '/api/moments/notifications/unread-count')).count === 0, 'mark notifications read');
      await p.screenshot({ path: path.join(out, 'notifications.png') }); await p.keyboard.press('Escape');
    });
    await record('F01-notifications-failure-preserves-unread', async () => {
      const m = await api(0, 'POST', '/api/moments', { content: '读取失败-' + stamp, visibility: 'all' });
      await api(1, 'POST', '/api/moments/' + m.id + '/like'); await moments(p);
      const before = (await api(0, 'GET', '/api/moments/notifications/unread-count')).count; assert.ok(before > 0);
      let reads = 0; const observe = req => { if (req.url().endsWith('/notifications/read')) reads++; }; p.on('request', observe);
      for (const response of [{ status: 500, json: {} }, { json: { items: 'invalid' } }]) {
        await p.route('**/api/moments/notifications?*', r => r.fulfill(response));
        await p.getByRole('button', { name: /互动消息/ }).click();
        await p.getByRole('dialog', { name: '互动消息', exact: true }).getByRole('alert').waitFor();
        assert.equal((await api(0, 'GET', '/api/moments/notifications/unread-count')).count, before);
        await p.keyboard.press('Escape'); await p.unroute('**/api/moments/notifications?*');
      }
      p.off('request', observe); assert.equal(reads, 0);
      await p.route('**/api/moments/notifications/read', r => r.fulfill({ status: 503, json: {} }));
      await p.getByRole('button', { name: /互动消息/ }).click();
      const dialog = p.getByRole('dialog', { name: '互动消息', exact: true }); await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').innerText(), /未读提醒已保留/);
      assert.equal((await api(0, 'GET', '/api/moments/notifications/unread-count')).count, before);
      await p.unroute('**/api/moments/notifications/read'); await dialog.getByRole('button', { name: '重试', exact: true }).click();
      await poll(async () => (await api(0, 'GET', '/api/moments/notifications/unread-count')).count === 0, 'read retry'); await p.keyboard.press('Escape');
    });
    await record('F04-collection-all-search-pages-failure-retry', async () => {
      const keyword = '完整收藏-' + stamp;
      for (let i = 0; i < 55; i++) await api(0, 'POST', '/api/users/me/collections', { type: 'text', content: keyword + '-' + i });
      await p.getByTestId('nav-tab-favorites').click(); await p.getByTestId('collection-search-input').fill(keyword);
      await poll(async () => await p.getByTestId('collection-item').count() === 55, '55 search results');
      await p.route('**/api/users/me/collections/search?*', r => Number(new URL(r.request().url()).searchParams.get('offset')) > 0 ? r.fulfill({ status: 500, json: {} }) : r.continue());
      await p.getByTestId('collection-search-input').fill(keyword + '-');
      await p.getByRole('alert').waitFor(); assert.equal(await p.getByTestId('collection-item').count(), 0);
      await p.unroute('**/api/users/me/collections/search?*'); await p.getByRole('button', { name: '重试', exact: true }).click();
      await poll(async () => await p.getByTestId('collection-item').count() === 55, '55 search results after retry');
      await p.getByTestId('collection-search-input').fill('definitely-no-match-' + stamp);
      await p.getByTestId('collection-empty').waitFor(); assert.equal(await p.getByTestId('collection-item').count(), 0);
      await p.getByTestId('collection-search-input').fill(keyword); await p.getByTestId('collection-search-input').fill('definitely-no-match-' + stamp);
      await p.getByTestId('collection-empty').waitFor(); assert.equal(await p.getByTestId('collection-item').count(), 0);
      await p.getByTestId('collection-search-input').fill('');
      return { expected: 55, rendered: 55, laterPageFailureRetried: true };
    });
    await record('F06-active-chat-presence-and-reconnect', async () => {
      const peer = await context(); const q = await login(peer, 1);
      await p.getByTestId('nav-tab-chats').click(); await p.getByTestId('conv-item-' + f.conversationId).click();
      const header = p.locator('.wc-chat-header');
      await poll(async () => (await header.innerText()).includes('在线'), 'peer online');
      await q.evaluate(() => window.__touliaoSocket.disconnect());
      await poll(async () => !(await header.innerText()).includes('在线'), 'peer offline in open chat');
      await q.evaluate(() => window.__touliaoSocket.connect());
      await poll(async () => (await header.innerText()).includes('在线'), 'peer online again');
      await p.evaluate(() => window.__touliaoSocket.disconnect());
      await q.evaluate(() => window.__touliaoSocket.disconnect());
      await poll(async () => (await api(0, 'GET', '/api/messages/conversations')).find(x => x.id === f.conversationId).otherUser.status !== 'online', 'server peer offline');
      await p.evaluate(() => window.__touliaoSocket.connect());
      await poll(async () => await p.evaluate(() => window.__touliaoSocket.connected), 'viewer reconnected');
      assert.ok(!(await header.innerText()).includes('在线'));
      await p.evaluate(() => window.__touliaoSocket.disconnect());
      await q.evaluate(() => window.__touliaoSocket.connect());
      await poll(async () => (await api(0, 'GET', '/api/messages/conversations')).find(x => x.id === f.conversationId).otherUser.status === 'online', 'peer online while viewer disconnected');
      await p.evaluate(() => window.__touliaoSocket.connect());
      await poll(async () => (await header.innerText()).includes('在线'), 'reconnect snapshot repairs missed online event');
      await peer.close();
    });
    await record('regression-chat-send-collect-source', async () => {
      await p.getByTestId('nav-tab-chats').click(); await p.getByTestId('conv-item-' + f.conversationId).click();
      const content = '消息回归-' + stamp;
      await p.getByTestId('chat-msg-input').fill(content); await p.getByTestId('chat-send-btn').click();
      await poll(async () => (await api(0, 'GET', '/api/messages/' + f.conversationId)).some(m => m.content === content), 'message persisted');
      const msg = (await api(0, 'GET', '/api/messages/' + f.conversationId)).find(m => m.content === content);
      await p.getByTestId('msg-bubble-' + msg.id).click({ button: 'right' }); await p.getByTestId('ctx-collect').click();
      await p.getByTestId('nav-tab-favorites').click();
      await p.getByTestId('collection-item').filter({ hasText: content }).getByRole('button', { name: '跳转到原消息' }).click();
      await p.getByTestId('msg-bubble-' + msg.id).waitFor();
    });
    await record('F07-login-profile-health-contract', async () => {
      const electron = await context(); await electron.addInitScript(() => { window.__ELECTRON_CONFIG__ = {}; });
      const page = await electron.newPage(); await page.goto(f.base + '/login');
      await page.getByTestId('login-switch-server-toggle').click(); await page.locator('input.auth-server-input').last().fill(f.base);
      for (const response of [{ status: 503, json: {} }, { status: 404, body: 'not found' }, { status: 200, body: '<html>proxy</html>' }, { json: { ok: false, service: 'touliao-backend' } }, { json: { ok: true, service: 'touliao-backend' } }]) {
        await page.route('**/health', r => r.fulfill(response)); await page.getByRole('button', { name: '测试连接', exact: true }).click();
        await page.locator('.auth-server-result').waitFor(); const text = await page.locator('.auth-server-result').innerText();
        assert.equal(text.includes('成功'), response.json?.ok === true, JSON.stringify(response)); await page.unroute('**/health');
      }
      const profile = await login(electron);
      await profile.getByTestId('nav-tab-me').click();
      await profile.getByRole('button', { name: /服务器地址/ }).click();
      await profile.getByRole('textbox', { name: '服务器地址', exact: true }).fill(f.base);
      await profile.route('**/health', r => r.fulfill({ status: 503, json: {} }));
      await profile.getByRole('button', { name: '测试连接', exact: true }).click();
      await profile.locator('.profile-test-result').waitFor(); assert.ok(!(await profile.locator('.profile-test-result').innerText()).includes('成功'));
      await profile.unroute('**/health');
      await profile.getByRole('button', { name: '测试连接', exact: true }).click();
      await poll(async () => (await profile.locator('.profile-test-result').allTextContents()).some(t => t.includes('成功')), 'profile healthy server');
      await electron.close();
    });
    await record('regression-profile-qr-keyboard', async () => {
      await p.getByTestId('nav-tab-me').click();
      await p.getByRole('button', { name: '我的二维码', exact: true }).press('Enter');
      const dialog = p.getByRole('dialog', { name: '我的二维码', exact: true });
      await dialog.waitFor(); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      assert.equal(await p.locator('.wc-me-profile-btn').count(), 1);
    });
    await record('UI-desktop-mobile-layout-zoom', async () => {
      await p.reload();
      for (const tab of ['moments', 'favorites', 'me']) {
        await p.getByTestId('nav-tab-' + tab).click();
        const width = await p.locator('.wc-panel').evaluate(e => e.getBoundingClientRect().width);
        assert.ok(width > 1000, tab + ' width ' + width); assert.equal(await p.locator('.home-chat-area').count(), 0);
      }
      const measurements = [];
      for (const width of [320, 390, 768]) {
        const mobile = await context({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true }); const page = await login(mobile);
        for (const tab of ['chats', 'contacts', 'moments', 'favorites', 'me']) {
          await page.getByTestId('nav-tab-' + tab).click(); await page.waitForTimeout(200);
          const layout = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, zoom: document.querySelector('meta[name="viewport"]').content }));
          assert.ok(layout.scrollWidth <= layout.viewport, tab + JSON.stringify(layout)); assert.ok(!/user-scalable=no|maximum-scale=1(?:\D|$)/.test(layout.zoom));
          measurements.push({ width, tab, ...layout });
          if (width === 390 && tab === 'moments') await page.screenshot({ path: path.join(out, 'moments-mobile390.png') });
        }
        await mobile.close();
      }
      return { measurements };
    });
    await record('UI-axe-light-dark', async () => {
      const findings = [];
      for (const theme of ['light', 'dark']) {
        await p.evaluate(t => localStorage.setItem('wc_theme', t), theme); await p.reload();
        for (const tab of ['chats', 'moments', 'favorites', 'me']) {
          await p.getByTestId('nav-tab-' + tab).click(); await p.waitForTimeout(400);
          await p.addScriptTag({ path: process.env.AXE_SCRIPT || require.resolve('axe-core/axe.min.js') });
          const data = await p.evaluate(async () => {
            const r = await axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast', 'meta-viewport', 'nested-interactive'] } });
            return { violations: r.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, summary: n.failureSummary })) })), incomplete: r.incomplete.map(v => ({ id: v.id, count: v.nodes.length })) };
          });
          findings.push({ theme, tab, ...data });
          await p.screenshot({ path: path.join(out, tab + '-' + theme + '.png') });
        }
      }
      fs.writeFileSync(path.join(out, 'axe-results.json'), JSON.stringify(findings, null, 2));
      assert.equal(findings.reduce((n, x) => n + x.violations.length, 0), 0, JSON.stringify(findings.filter(x => x.violations.length)));
      return { pages: findings.length, violations: 0, incomplete: findings.filter(x => x.incomplete.length).map(x => ({ theme: x.theme, tab: x.tab, incomplete: x.incomplete })) };
    });
    await record('no-browser-runtime-errors', async () => { assert.deepEqual(pageErrors, []); });
    await c.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
