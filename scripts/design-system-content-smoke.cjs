'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../desktop-electron/node_modules/playwright');
const { fixture } = require('./windows-ui-smoke.cjs');
const { capture, report, server, out } = require('./design-system-smoke.cjs');
async function run() {
  fs.mkdirSync(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    for (const [platform, width, height] of [['win32', 1200, 800], ['web', 390, 844]]) for (const theme of ['light', 'dark']) {
      const prefix = `${platform}-${width}-${theme}`, sent = [], requests = [];
      let allowRetry = false;
      const { context, page, errors, emitSocket, disconnectSocket } = await fixture(browser, base, { platform, width, height, theme, skin: 'touliao', messageReply: payload => {
        sent.push(payload);
        return !allowRetry ? { success: false, error: '隔离测试：模拟发送失败' } : { success: true, message: { id: 'retry-success', client_msg_id: payload.clientMsgId, conversation_id: 'ui-0', sender_id: 'ui-me', type: 'text', content: payload.content, created_at: 1789719999, seq: 1000 } };
      } });
      page.setDefaultTimeout(10000);
      const moment = { id: 'moment-1', author: { id: 'peer-0', username: '林晓' }, content: '今天整理了项目资料，和大家分享进展。\n这里的数据仅用于隔离的界面验收。', images: [], liked: false, likes: [], likeCount: 0, comments: [], commentCount: 0, created_at: 1789711000 };
      let callsFail = true, uploadFail = true;
      await context.route('**/api/**', async route => {
        const req = route.request(), p = new URL(req.url()).pathname;
        const body = req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
        requests.push({ path: p, method: req.method(), body });
        if (p === '/api/upload/credential') return route.fulfill({ status: 503, json: { error: 'isolated local upload' } });
        if (p === '/api/messages/ui-0/upload') {
          if (uploadFail) return route.fulfill({ status: 503, json: { error: '隔离测试：上传失败，可重试' } });
          await route.fulfill({ json: { success: true } });
          emitSocket('new_message', { id: 'uploaded-file', seq: 1001, conversation_id: 'ui-0', sender_id: 'ui-me', senderName: '界面体验', type: 'file', content: '拖放验收.txt', file_url: '/uploads/fixture.txt', file_size: 20, created_at: 1789720000 });
          return;
        }
        let json;
        if (p === '/api/moments') json = [moment];
        else if (p === '/api/moments/moment-1/like') json = { liked: true, likeCount: 1 };
        else if (p === '/api/moments/moment-1/comment') json = { id: 'comment-1', user_id: 'ui-me', username: '界面体验', content: req.postDataJSON().content };
        else if (p === '/api/users/me/collections') {
          await new Promise(r => setTimeout(r, 650));
          json = [{ id: 'collection-1', type: 'text', content: '资料整理：保留现有功能，逐项验收界面。', created_at: 1789711000, extra: {} }];
        } else if (p === '/api/users/me/collections/search') json = { items: [] };
        else if (p === '/api/users/me/call-logs') return route.fulfill({ status: callsFail ? 503 : 200, json: callsFail ? { error: '测试网络异常' } : [] });
        else if (p === '/api/messages/ui-0') json = Array.from({ length: 120 }, (_, i) => ({ id: 'history-' + i, seq: i + 1, conversation_id: 'ui-0', sender_id: i % 2 ? 'ui-me' : 'peer-0', senderName: i % 2 ? '界面体验' : '林晓', type: 'text', content: `历史消息 ${i + 1}：检查长会话的滚动和消息位置。${i % 4 ? '' : '\n多行内容保留完整。'}`, created_at: 1789700000 + i * 60 }));
        if (json !== undefined) return route.fulfill({ json });
        return route.fallback();
      });
      const shot = name => capture(page, prefix + '-' + name, errors);
      await page.getByTestId('nav-tab-moments').click();
      await page.locator('.wc-moment-card').first().waitFor();
      await shot('discover');
      await page.locator('.wc-moment-action-btn').first().click();
      await page.locator('.wc-moment-action-btn.liked').waitFor();
      assert.ok(requests.some(r => r.path.endsWith('/moment-1/like') && r.method === 'POST'));
      await page.locator('.wc-moment-action-btn').nth(1).click();
      await page.locator('.wc-moment-comment-field').fill('验收评论');
      await page.locator('.wc-moment-comment-submit').click();
      await page.locator('.wc-moment-comment').filter({ hasText: '验收评论' }).waitFor();
      await shot('discover-comment');
      await page.locator('.wc-moment-composer').click();
      await page.locator('.wc-moment-editor textarea').fill('这是一条未提交的发布草稿。');
      await page.locator('.wc-moment-vis-select').selectOption('private');
      await shot('publish');
      await page.locator('.wc-moment-editor-cancel').click();
      assert.ok(!requests.some(r => r.path === '/api/moments' && r.method === 'POST'), 'cancel does not publish draft');
      await page.getByTestId('nav-tab-favorites').click();
      await page.locator('.wc-skeleton').waitFor();
      await shot('favorites-loading');
      await page.getByTestId('collection-item').waitFor();
      await shot('favorites');
      await page.getByTestId('collection-search-input').fill('无匹配结果');
      await page.getByTestId('collection-empty').waitFor();
      await shot('favorites-empty');
      await page.getByTestId('nav-tab-calls').click();
      await page.getByText('点击重试', { exact: false }).waitFor();
      await shot('calls-error');
      callsFail = false;
      await page.getByText('点击重试', { exact: false }).click();
      await page.waitForTimeout(200);
      await shot('calls-empty');
      await page.getByTestId('nav-tab-chats').click();
      await page.getByTestId('conv-item-ui-0').click();
      await page.locator('.cw-msg-scroll').waitFor();
      await page.waitForTimeout(1200);
      const scroller = page.locator('.cw-msg-scroll');
      await scroller.evaluate(e => { e.scrollTop = Math.floor(e.scrollHeight / 3); });
      await page.waitForTimeout(350);
      const top = await scroller.evaluate(e => e.scrollTop);
      emitSocket('new_message', { id: 'live-new', seq: 121, conversation_id: 'ui-0', sender_id: 'peer-0', senderName: '林晓', type: 'text', content: '阅读历史消息时的新消息', created_at: 1789709000 });
      await page.waitForTimeout(350);
      const after = await scroller.evaluate(e => e.scrollTop);
      assert.ok(Math.abs(after - top) < 2, `reading history does not jump on incoming message: ${top} → ${after}`);
      await shot('history-anchor');
      await scroller.evaluate(e => { e.scrollTop = e.scrollHeight; });
      await page.waitForTimeout(500);
      await page.getByPlaceholder('输入消息…').fill('保留并重试这条消息');
      await page.getByTestId('chat-send-btn').click();
      await page.getByTestId('msg-send-failed').waitFor().catch(async error => {
        console.log('FAILED_SEND_DIAGNOSTICS', JSON.stringify({ sent, errors, input: await page.getByTestId('chat-msg-input').inputValue(), rows: await page.locator('.wc-msg-bubble').allTextContents(), scroll: await scroller.evaluate(e => ({ top: e.scrollTop, height: e.scrollHeight, viewport: e.clientHeight })) }));
        await page.screenshot({ path: path.join(out, prefix + '-send-debug.png') });
        throw error;
      });
      await page.waitForTimeout(700);
      const failedBounds = await page.getByTestId('msg-send-failed').boundingBox();
      const scrollBounds = await scroller.boundingBox();
      const failedVisible = failedBounds && failedBounds.y >= scrollBounds.y && failedBounds.y + failedBounds.height <= scrollBounds.y + scrollBounds.height;
      if (!failedVisible) await page.screenshot({ path: path.join(out, prefix + '-send-debug.png') });
      assert.ok(failedVisible, 'failed send remains in the visible viewport after status/layout settles: ' + JSON.stringify({ failedBounds, scrollBounds, scroll: await scroller.evaluate(e => ({ top: e.scrollTop, height: e.scrollHeight, viewport: e.clientHeight })) }));
      await shot('send-failed');
      allowRetry = true;
      await page.getByTestId('msg-send-failed').click();
      await page.getByTestId('msg-bubble-retry-success').waitFor();
      assert.ok(sent.length >= 2);
      assert.ok(sent.every(item => item.clientMsgId === sent[0].clientMsgId), 'automatic and manual retries retain idempotency key');
      assert.equal(await page.getByTestId('msg-send-failed').count(), 0);
      await shot('send-retried');
      const input = page.getByTestId('chat-msg-input');
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate(() => navigator.clipboard.writeText('粘贴的中文文本'));
      await input.focus();
      await input.press('Control+V');
      assert.equal(await input.inputValue(), '粘贴的中文文本');
      if (width < 768) {
        await page.setViewportSize({ width, height: 520 });
        await shot('keyboard-height');
        assert.equal(await input.inputValue(), '粘贴的中文文本');
        await page.setViewportSize({ width, height });
      }
      await input.fill('');
      // Real drag/drop handler, credential fallback, local upload error, then retry.
      await page.locator('.wc-chat').evaluate(e => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['隔离测试附件'], '拖放验收.txt', { type: 'text/plain' }));
        e.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      });
      await page.locator('.wc-upload-bar-error').waitFor();
      await shot('upload-error');
      uploadFail = false;
      await page.locator('.wc-retry-btn').click();
      await page.getByTestId('msg-bubble-uploaded-file').waitFor();
      await shot('upload-retried');
      assert.ok(requests.filter(r => r.path === '/api/messages/ui-0/upload').length >= 2);
      // Denied permission is explicit; no synthetic recording is inserted.
      await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('fixture denied', 'NotAllowedError'); }; });
      await page.getByRole('button', { name: '语音输入', exact: true }).click();
      await page.getByTestId('chat-voice-btn').dispatchEvent('mousedown');
      await page.locator('.wc-toast').waitFor();
      await shot('recording-permission-denied');
      await page.getByRole('button', { name: '切换文字输入', exact: true }).click();
      disconnectSocket();
      await page.getByTestId('net-banner').waitFor();
      await shot('offline');
      await context.close();
    }
    report.passed = true;
  } finally {
    await browser.close(); server.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
