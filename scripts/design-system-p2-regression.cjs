'use strict';
// Actual application routes with isolated API/socket fixtures; not a mock UI.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../desktop-electron/node_modules/playwright');
const { fixture } = require('./windows-ui-smoke.cjs');
const { server, shot, report } = require('./design-system-p1-helpers.cjs');
const O = require('node:path').resolve(process.env.UI_OUTPUT || 'artifacts/design-system-p2');
async function run() {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    for (const [platform, width, height] of [['web', 320, 568], ['win32', 1200, 800]]) for (const theme of ['light', 'dark']) {
      const events = [], f = await fixture(browser, base, { platform, width, height, theme, skin: 'touliao', onSocketEvent: (event, payload) => events.push({ event, payload }) });
      const { page, context, emitSocket } = f, prefix = 'p2-' + platform + '-' + theme;
      page.setDefaultTimeout(15000);
      try {
        // Existing visual child must remain centered despite the caller's display:block.
        for (const type of ['audio', 'video']) {
          emitSocket('call:incoming', { from: 'peer-0', type, caller: { name: '中文昵称' }, callId: prefix + type });
          await page.getByTestId('call-reject-btn').waitFor();
          const metrics = await page.locator('[data-testid="call-modal"] .wc-avatar-face').evaluate(el => {
            const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
            return { width: rect.width, height: rect.height, display: css.display, align: css.alignItems, justify: css.justifyContent };
          });
          assert.equal(metrics.width, type === 'video' ? 88 : 110);
          assert.equal(metrics.height, metrics.width); assert.equal(metrics.display, type === 'video' ? 'flex' : 'inline-flex');
          assert.equal(metrics.align, 'center'); assert.equal(metrics.justify, 'center');
          const discs = await page.locator('.tl-call-control-disc').evaluateAll(es => es.map(e => ({ size: e.getBoundingClientRect().width, color: getComputedStyle(e).backgroundColor })));
          assert.deepEqual(discs.map(d => d.size), [68, 56, 68]);
          await shot(page, prefix + '-' + type + '-incoming');
          await page.getByTestId('call-reject-btn').click();
          await page.getByTestId('call-modal').waitFor({ state: 'detached' });
          assert.ok(events.some(e => e.event === 'call:response' && e.payload.callId === prefix + type && e.payload.accepted === false));
          report.scenarios.push({ prefix, type, avatar: metrics, controls: discs, rejection: 'PASS' });
        }
        // A failed search is an error with a retry action, never an empty result.
        let fail = true, requests = 0;
        await context.route('**/api/messages/search*', r => { requests++; return r.fulfill(fail ? { status: 500, json: { error: '隔离测试：搜索失败' } } : { json: { results: [] } }); });
        const search = page.locator('input[aria-label="搜索"]:visible').first();
        await search.fill('不存在的长中文昵称123');
        await page.locator('.gs-scroll .wc-state--error').waitFor();
        await shot(page, prefix + '-search-error');
        fail = false; const before = requests;
        await page.locator('.gs-scroll .wc-state-retry').click();
        await page.locator('.gs-scroll .wc-state--empty').waitFor(); assert.ok(requests > before);
        await page.locator('.gs-network-row').focus();
        await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
        assert.equal(await page.locator('.gs-network-row').evaluate(e => document.activeElement === e), true);
        assert.notEqual(await page.locator('.gs-network-row').evaluate(e => getComputedStyle(e).outlineStyle), 'none');
        await shot(page, prefix + '-search-empty-focus');
        await search.fill('');
        // Empty contacts use the same state layout while preserving the existing illustration.
        await context.route('**/api/users/contacts*', r => r.fulfill({ json: [] }));
        await page.getByTestId('nav-tab-contacts').click();
        await page.locator('.cl-empty.wc-state').first().waitFor();
        await shot(page, prefix + '-contacts-empty');
        await page.getByTestId('nav-tab-chats').click();
        await context.route('**/api/messages/ui-0*', async r => {
          await new Promise(resolve => setTimeout(resolve, 2500));
          return r.fulfill({ json: [] }).catch(() => {});
        });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.getByTestId('conv-item-ui-0').click();
        const skeleton = page.locator('.wc-skeleton--chat'); await skeleton.waitFor();
        assert.equal(await skeleton.getAttribute('role'), 'status');
        assert.equal(await skeleton.getAttribute('aria-busy'), 'true');
        await skeleton.locator('.wc-skeleton-avatar').first().waitFor();
        const geometry = await skeleton.locator('.wc-skeleton-avatar').first().evaluate(e => ({
          width: e.getBoundingClientRect().width, radius: getComputedStyle(e).borderRadius,
          animation: getComputedStyle(e, '::after').animationName,
        }));
        assert.equal(geometry.width, 36); assert.notEqual(geometry.radius, '50%'); assert.equal(geometry.animation, 'none');
        await shot(page, prefix + '-skeleton-reduced');
        report.scenarios.push({ prefix, searchRetry: 'PASS', contactsEmpty: 'PASS', skeleton: geometry });
      } catch (e) { report.errors.push({ prefix, error: e.stack }); await page.screenshot({ path: O + '/evidence/' + prefix + '-failed.png' }); }
      report.errors.push(...f.errors.map(error => ({ prefix, error }))); await context.close();
      // Native browser focus/disabled behavior on the real login page, no authentication sent.
      const auth = await fixture(browser, base, { platform, width, height, theme, skin: 'touliao', authenticated: false });
      try {
        const input = auth.page.getByTestId('login-phone-input'); await input.focus();
        await auth.page.emulateMedia({ reducedMotion: 'reduce' });
        const field = auth.page.locator('.tl-field').filter({ has: input });
        assert.equal(await field.getAttribute('data-state'), 'FOCUSED');
        assert.equal(await auth.page.getByTestId('login-submit-btn').isDisabled(), true);
        const duration = await field.locator('.tl-field-control').evaluate(e => getComputedStyle(e).transitionDuration);
        assert.ok(duration.split(',').every(x => parseFloat(x) === 0));
        await shot(auth.page, prefix + '-login-focus-disabled-reduce');
        report.scenarios.push({ prefix, fieldState: 'FOCUSED', submitDisabled: true, reduceTransition: duration });
      } catch (e) { report.errors.push({ prefix, error: e.stack }); }
      report.errors.push(...auth.errors); await auth.context.close();
    }
  } finally {
    await browser.close(); server.close(); report.passed = !report.errors.length;
    fs.writeFileSync(O + '/evidence/p2-review.json', JSON.stringify(report, null, 2));
  }
  assert.deepEqual(report.errors, []);
}
run().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
