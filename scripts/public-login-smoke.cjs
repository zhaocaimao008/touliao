'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('../desktop-electron/node_modules/playwright');
const base = process.env.BASE_URL || 'https://touliao.cc';
const out = process.env.SMOKE_OUTPUT || '/tmp/touliao-public-smoke';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('content-type').includes('application/json'), true);
  assert.equal((await health.json()).db, 'ok');
  const expected = fs.readFileSync(path.join(__dirname, '../web/dist/index.html'));
  const actual = Buffer.from(await (await fetch(base)).arrayBuffer());
  assert.equal(hash(actual), hash(expected), 'Public index matches tested build');
  const assets = [...expected.toString().matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]);
  for (const url of [...new Set(assets), '/sw.js', '/push-sw.js']) {
    const response = await fetch(`${base}${url}`);
    assert.equal(response.status, 200, url);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(fs.readFileSync(path.join(__dirname, '../web/dist', url))), url);
  }
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.locator('#login-phone').waitFor();
      await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(out, `login-${viewport.width}.png`), fullPage: true });
      await context.close();
    }
    console.log(JSON.stringify({ health: 'ok', assetsMatch: true, loginViewports: 2, brokenImages: 0, pageErrors: 0, horizontalOverflow: false, screenshots: out }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
