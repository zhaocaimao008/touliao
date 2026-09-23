'use strict';
// Real desktop renderer, isolated IPC fixtures. Native installed IPC is tested separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../desktop-electron/node_modules/playwright');
const { fixture } = require('./windows-ui-smoke.cjs');
const { server } = require('./design-system-smoke.cjs');
const out = path.resolve(process.env.UI_OUTPUT || 'artifacts/windows-update-feedback-browser');
const report = { sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  runtime: process.platform, nativeWindows: false, mockedIPC: true, cases: [] };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    for (const theme of ['light', 'dark']) {
      const { page, context, errors } = await fixture(browser, `http://127.0.0.1:${server.address().port}`,
        { authenticated: false, width: 900, height: 600, theme });
      const event = (name, detail) => page.evaluate(({ name, detail }) =>
        window.dispatchEvent(new CustomEvent('electron:update-' + name, { detail })), { name, detail });
      const text = value => page.getByText(value, { exact: true }).waitFor();
      const capture = async name => {
        const banner = page.locator('.wc-update-banner');
        const box = await banner.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= 900 && box.y + box.height <= 600, name + ' fits');
        const overflow = await banner.evaluate(e => e.scrollWidth > e.clientWidth + 1);
        assert.equal(overflow, false, name + ' text does not overflow');
        assert.deepEqual(errors, [], name + ' no runtime errors');
        await page.screenshot({ path: path.join(out, `${theme}-${name}.png`), animations: 'disabled' });
        report.cases.push({ theme, name, box, passed: true });
      };
      // An automatic no-update result stays quiet; clicking check must always finish visibly.
      await event('not-available', { version: '8.1.29' });
      assert.equal(await page.locator('.wc-update-banner').count(), 0);
      await page.locator('.wc-update-check-btn').click();
      await text('正在检查更新…');
      await event('not-available', { version: '8.1.29' });
      await text('当前没有可用更新（当前版本 8.1.29）');
      await capture('no-update');
      await page.locator('.wc-update-dismiss').click();
      // Tray checks follow the same visible state path.
      await event('checking'); await text('正在检查更新…');
      await event('not-available', { version: '8.1.29' });
      await text('当前没有可用更新（当前版本 8.1.29）');
      await page.locator('.wc-update-dismiss').click();
      await page.evaluate(() => { window.electronAPI.checkUpdate = async () => { throw new Error('检查失败：连接已断开'); }; });
      await page.locator('.wc-update-check-btn').click();
      await text('检查失败：连接已断开'); await capture('check-rejected');
      await page.locator('.wc-update-dismiss').click();
      await page.evaluate(() => { delete window.electronAPI.checkUpdate; });
      await page.locator('.wc-update-check-btn').click();
      await text('更新服务不可用，请重启客户端后重试'); await capture('bridge-unavailable');
      await page.locator('.wc-update-dismiss').click();
      await event('available', { version: '8.1.30' });
      await event('progress', 48); await text('下载中 48%'); await capture('download-progress');
      await event('error', '下载失败：网络中断，请重试');
      await text('下载失败：网络中断，请重试'); await capture('download-error');
      await event('downloaded', { version: '8.1.30' });
      await page.evaluate(() => { window.electronAPI.installUpdate = async () => { throw new Error('请在账号窗口 1 安装更新，安装前退出其他账号窗口。'); }; });
      await page.locator('.wc-update-install-btn').click();
      await text('请在账号窗口 1 安装更新，安装前退出其他账号窗口。'); await capture('install-refused');
      await event('downloaded', { version: '8.1.30' });
      await page.evaluate(() => {
        window.__installClicks = 0;
        window.electronAPI.installUpdate = () => { window.__installClicks++; return new Promise(() => {}); };
      });
      await page.locator('.wc-update-install-btn').click();
      await text('正在启动安装程序…');
      assert.equal(await page.locator('.wc-update-install-btn').isDisabled(), true);
      await page.locator('.wc-update-install-btn').evaluate(button => button.click());
      assert.equal(await page.evaluate(() => window.__installClicks), 1);
      await capture('installing');
      await event('error', '安装失败：无法启动安装程序');
      await text('安装失败：无法启动安装程序'); await capture('install-error');
      await context.close();
    }
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close(); server.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
