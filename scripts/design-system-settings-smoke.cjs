'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('../web/node_modules/qrcode');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../desktop-electron/node_modules/playwright');
const { fixture } = require('./windows-ui-smoke.cjs');
const { capture, report, server, out } = require('./design-system-smoke.cjs');
async function run() {
  fs.mkdirSync(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const qr = await QRCode.toString('touliao://user/ui-me', { type: 'svg', margin: 2 });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    for (const [platform, width, height] of [['win32', 1200, 800], ['web', 390, 844]]) for (const theme of ['light', 'dark']) {
      const prefix = `${platform}-${width}-${theme}`;
      const events = [], requests = [];
      const { context, page, errors, emitSocket } = await fixture(browser, base, { platform, width, height, theme, skin: 'touliao', onSocketEvent: (event, payload) => events.push({ event, payload }) });
      page.setDefaultTimeout(10000);
      await context.route('**/api/**', route => {
        const req = route.request(), p = new URL(req.url()).pathname;
        requests.push({ path: p, method: req.method(), body: req.postDataJSON() });
        let json;
        if (p === '/api/auth/sessions') json = [{ id: 'current', current: true, device: 'Windows 11 · 本机', platform: 'windows', last_active: 1789711200, ip: '127.0.0.1' }, { id: 'fixture-device', current: false, device: '另一台测试设备', platform: 'android', last_active: 1789704000, ip: '127.0.0.2' }];
        else if (p === '/api/auth/sessions/fixture-device') json = { success: true };
        else if (p === '/api/users/me/settings') json = { messageNotify: true, detailPreview: true, ...req.postDataJSON() };
        else if (p === '/api/users/me/qrcode') return route.fulfill({ contentType: 'image/svg+xml', body: qr });
        else if (p === '/api/users/me/call-logs') json = [{ id: 'call-1', peer_id: 'peer-0', peer_name: '林晓', type: 'audio', direction: 'in', status: 'missed', created_at: 1789711000 }, { id: 'call-2', peer_id: 'peer-2', peer_name: '陈远', type: 'video', direction: 'out', status: 'completed', duration: 128, created_at: 1789700000 }];
        else if (p === '/api/messages/conversation/ui-0/files') json = { total: 1, items: [{ id: 'file-1', type: 'file', fileName: '界面验收说明.txt', fileSize: 1200, fileUrl: '/uploads/ui-fixture.txt', senderName: '林晓', createdAt: 1789711000 }] };
        else if (p === '/api/messages/ui-0') json = [{ id: 'document-1', conversation_id: 'ui-0', sender_id: 'peer-0', senderName: '林晓', type: 'file', content: '界面验收说明.txt', file_url: '/uploads/ui-fixture.txt', file_size: 1200, mime_type: 'text/plain', created_at: 1789711000 }];
        if (json !== undefined) return route.fulfill({ json });
        return route.fallback();
      });
      await context.route('**/uploads/ui-fixture.txt*', route => route.fulfill({ contentType: 'text/plain; charset=utf-8', body: '投聊界面验收\n这是隔离测试中的文档预览。\n深色、浅色和窄屏布局检查。' }));
      const shot = name => capture(page, prefix + '-' + name, errors);
      await page.getByTestId('nav-tab-me').click();
      await page.locator('.wc-me-header').waitFor();
      await shot('profile');
      await page.locator('.wc-me-qr-btn').click();
      await page.locator('.home-qr-img').waitFor();
      await page.waitForFunction(() => document.querySelector('.home-qr-img')?.naturalWidth > 0);
      await shot('my-qr');
      await page.keyboard.press('Escape');
      await page.locator('.wc-me-header').click();
      await shot('edit-profile');
      await page.getByText('昵称', { exact: true }).click();
      await page.locator('.wc-edit-input').waitFor();
      await shot('edit-name');
      await page.locator('.wc-page-header-back').click();
      for (const [label, name] of [['设备管理','devices'], ['隐私与安全','privacy'], ['修改密码','account'], ['通知','notifications'], ['外观','appearance']]) {
        await page.getByText(label, { exact: true }).click();
        await page.locator('.wc-page-header-title').waitFor();
        if (name === 'devices') await page.locator('.wc-device-item').first().waitFor();
        if (name === 'notifications') await page.getByTestId('ringtone-select').waitFor();
        await shot(name);
        if (name === 'devices') {
          await page.locator('.wc-btn-exit').click();
          await page.getByText('另一台测试设备', { exact: true }).waitFor({ state: 'detached' });
          assert.ok(requests.some(r => r.path.endsWith('/sessions/fixture-device') && r.method === 'DELETE'));
        }
        if (name === 'notifications') {
          await page.getByTestId('ringtone-select').selectOption('soft');
          await page.waitForTimeout(100);
          assert.ok(requests.some(r => r.method === 'PUT' && r.body?.ringtone === 'soft'));
        }
        await page.locator('.wc-page-header-back').click();
      }
      await page.getByTestId('nav-tab-calls').click();
      await page.getByTestId('call-log-item').first().waitFor();
      await shot('call-history');
      for (const type of ['audio','video']) {
        emitSocket('call:incoming', { from: 'peer-0', type, caller: { name: '林晓' }, callId: 'fixture-' + type });
        await page.getByTestId('call-reject-btn').waitFor();
        await shot(type === 'audio' ? 'voice-call' : 'video-call');
        await page.getByTestId('call-reject-btn').click();
        await page.getByTestId('call-modal').waitFor({ state: 'detached' });
        assert.ok(events.some(e => e.event === 'call:response' && e.payload.callId === 'fixture-' + type && e.payload.accepted === false), 'reject uses real call response');
      }
      await page.getByTestId('nav-tab-chats').click();
      await page.getByTestId('conv-item-ui-0').click();
      await page.getByTestId('msg-bubble-document-1').waitFor();
      await page.getByTestId('msg-bubble-document-1').locator('a').click();
      await page.getByTestId('file-preview').waitFor();
      await page.getByText('投聊界面验收', { exact: false }).last().waitFor();
      await shot('file-preview');
      await page.getByTestId('file-preview-close').click();
      await page.getByTestId('chat-group-info-btn').click();
      await page.getByText('聊天文件', { exact: true }).click();
      await page.locator('.chatfiles-item').waitFor();
      await shot('files');
      await context.close();
      const auth = await fixture(browser, base, { platform, width, height, theme, skin: 'touliao', authenticated: false });
      auth.page.setDefaultTimeout(10000);
      await capture(auth.page, prefix + '-login', auth.errors);
      await auth.page.locator('a[href$="register"]').click();
      await auth.page.getByTestId('register-submit-btn').waitFor();
      await capture(auth.page, prefix + '-register', auth.errors);
      await auth.page.locator('a[href$="login"]').click();
      await auth.page.locator('a[href$="forgot-password"]').click();
      await auth.page.locator('.auth-note').waitFor();
      await capture(auth.page, prefix + '-forgot', auth.errors);
      await auth.context.close();
    }
    report.passed = true;
  } finally {
    await browser.close(); server.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
