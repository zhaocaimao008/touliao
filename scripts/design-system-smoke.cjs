'use strict';
// Isolated presentation/interaction evidence. No real account or server is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../desktop-electron/node_modules/playwright');
const { fixture } = require('./windows-ui-smoke.cjs');
const root = path.resolve(process.env.UI_BUILD || path.join(__dirname, '../web/dist'));
const out = path.resolve(process.env.UI_OUTPUT || path.join(__dirname, '../artifacts/design-system'));
const report = { nativeHost: process.platform, isolatedFixtures: true, nativeWindows: false, cases: [] };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  const target = file === root ? path.join(root, 'index.html') : file;
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
  fs.createReadStream(target).pipe(res);
});
async function capture(page, name, errors) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {})));
  });
  const metrics = await page.evaluate(() => {
    const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    const rows = [...document.querySelectorAll('[data-testid^="conv-item-ui-"]')].filter(e => e.getBoundingClientRect().width).map(box);
    const css = getComputedStyle(document.body);
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      theme: document.body.classList.contains('dark-mode') ? 'dark' : 'light',
      skin: document.body.dataset.skin,
      primary: css.getPropertyValue('--tl-primary').trim(),
      surface: css.getPropertyValue('--tl-surface').trim(),
      rows,
      icons: document.querySelectorAll('.tl-icon').length,
      composer: document.querySelector('.wc-input-area') ? box(document.querySelector('.wc-input-area')) : null,
      font: css.fontFamily,
    };
  });
  await page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled' });
  report.cases.push({ name, ...metrics });
  assert.deepEqual(errors, [], name + ': no runtime errors');
  assert.equal(metrics.overflow, false, name + ': no page overflow');
  for (let i = 1; i < metrics.rows.length; i++) assert.ok(metrics.rows[i - 1].bottom <= metrics.rows[i].y + .5, name + ': virtual rows do not overlap');
  if (process.env.UI_BASELINE !== '1') for (const row of metrics.rows) assert.equal(row.height, page.viewportSize().width < 768 ? 76 : 68, name + ': design row height');
  if (process.env.UI_BASELINE !== '1') {
    assert.equal(metrics.skin, 'touliao');
    assert.equal(metrics.primary.toLowerCase(), metrics.theme === 'dark' ? '#7ca7ff' : '#2864f0', name + ': supplied primary token');
    assert.ok(metrics.icons > 0, name + ': supplied icons rendered');
  }
  if (metrics.composer) assert.ok(metrics.composer.bottom <= page.viewportSize().height + 1, name + ': composer visible');
  console.log('PASS', name);
}
async function run() {
  fs.mkdirSync(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    for (const [platform, width, height] of [['win32', 1200, 800], ['win32', 900, 600], ['web', 1200, 800], ['web', 390, 844]]) {
      for (const theme of ['light', 'dark']) {
        const prefix = `${platform}-${width}-${theme}`;
        const { context, page, errors } = await fixture(browser, base, { platform, width, height, theme, skin: 'touliao' });
        await page.getByTestId('conv-item-ui-0').waitFor();
        await capture(page, prefix + '-conversations', errors);
        if (process.env.UI_BASELINE !== '1') {
          await page.getByTestId('conversation-filter-groups').click();
          await page.getByTestId('conv-item-ui-1').waitFor();
          assert.equal(await page.getByTestId('conv-item-ui-0').count(), 0);
          await page.getByTestId('conversation-filter-unread').click();
          assert.ok(await page.getByTestId('conv-item-ui-0').count());
          assert.equal(await page.getByTestId('conv-item-ui-2').count(), 0);
          await page.getByTestId('conversation-filter-all').click();
        }
        await page.getByTestId('conv-item-ui-0').click();
        await page.locator('.wc-msg-bubble').first().waitFor();
        await capture(page, prefix + '-chat', errors);
        // Resizing must retain a real composer draft.
        const input = page.getByPlaceholder('输入消息…');
        await input.fill('中文草稿，尚未发送');
        await page.setViewportSize({ width: width + 20, height });
        assert.equal(await input.inputValue(), '中文草稿，尚未发送');
        await page.setViewportSize({ width, height });
        await input.fill('');
        await input.fill('输入法选词');
        await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
        assert.equal(await input.inputValue(), '输入法选词', prefix + ': IME does not submit');
        assert.equal(await page.getByTestId('msg-bubble-fixture-sent').count(), 0);
        await input.press('Shift+Enter');
        assert.ok((await input.inputValue()).includes('\n'), prefix + ': Shift+Enter inserts newline');
        await input.fill('通过既有 WebSocket 发送');
        await page.getByTestId('chat-send-btn').click();
        await page.getByTestId('msg-bubble-fixture-sent').waitFor();
        assert.equal(await input.inputValue(), '', prefix + ': acknowledged send clears composer');
        await capture(page, prefix + '-sent', errors);
        if (width < 768) await page.locator('.wc-chat-header-back').click();
        await page.getByTestId('nav-tab-contacts').click();
        await page.getByText('新的朋友', { exact: true }).waitFor();
        await capture(page, prefix + '-contacts', errors);
        await page.getByTestId('nav-tab-me').click();
        await page.locator('.wc-me-header').waitFor();
        await capture(page, prefix + '-profile', errors);
        await page.getByText('外观', { exact: true }).click();
        await page.locator('.wc-appearance-btn').first().waitFor();
        await capture(page, prefix + '-appearance', errors);
        await context.close();
      }
    }
    report.passed = true;
  } finally {
    await browser.close();
    server.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
if (require.main === module) run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
module.exports = { capture, report, server, out };

