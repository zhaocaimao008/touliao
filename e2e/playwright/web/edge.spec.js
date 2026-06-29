'use strict';
const path = require('path');
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

const FIX = path.join(__dirname, '..', '..', 'fixtures');

async function loginOpen(webPage, baseURL, seeded) {
  const login = new LoginPage(webPage);
  const chat = new ChatPage(webPage);
  await login.gotoLogin(baseURL);
  await login.login(seeded.users[0].phone, seeded.users[0].password);
  await chat.waitReady();
  await chat.openConv(seeded.convAB);
  return chat;
}

test.describe('边界/异常/性能 EDGE', () => {
  test('EDGE-01 大文件(9MB)分片上传 → 文件气泡出现', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    test.setTimeout(60000); // 分片上传较慢
    const chat = await loginOpen(webPage, baseURL, seeded);
    await chat.sendFile(path.join(FIX, 'bigfile.txt')); // 9MB, text/plain(在accept内),>8MB触发分片
    // 分片上传(init→chunk→finish)完成后,文件消息渲染(气泡含文件名)
    await expect(webPage.locator('[data-testid="msg-file"]').last())
      .toBeVisible({ timeout: 45000 });
    await expect(webPage.locator('.wc-msg-file-name').last()).toContainText('bigfile.txt');
  });

  test('EDGE-02 并发快速发送 5 条 → 全部到达且不重复', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginOpen(webPage, baseURL, seeded);
    const before = await chat.bubbleCount();
    const tag = 'concurrent-' + Date.now();
    // 不等 ack 连发 5 条(模拟手快)
    for (let i = 0; i < 5; i++) {
      await chat.tid('chat-msg-input').fill(`${tag}-${i}`);
      await chat.tid('chat-send-btn').click();
    }
    // 5 条都出现,且总数恰好 +5(不丢不重)
    for (let i = 0; i < 5; i++) {
      await expect(webPage.locator('[data-testid^="msg-bubble-"]', { hasText: `${tag}-${i}` }))
        .toHaveCount(1, { timeout: 10000 });
    }
    await expect.poll(() => chat.bubbleCount(), { timeout: 8000 }).toBe(before + 5);
  });

  test('EDGE-03 超长消息(4000字) → 正常渲染不崩', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginOpen(webPage, baseURL, seeded);
    const longText = 'L'.repeat(4000) + '-' + Date.now();
    await chat.sendText(longText);
    await chat.expectMessageVisible(longText.slice(0, 50)); // 含开头即视为渲染成功
    // 界面没崩:输入框仍可用
    await expect(chat.tid('chat-msg-input')).toBeVisible();
  });

  test('EDGE-04 特殊字符/emoji/HTML → 转义不破坏(无XSS)', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginOpen(webPage, baseURL, seeded);
    const payload = `<script>window.__xss=1</script>😀&"'`+ '-' + Date.now();
    await chat.sendText(payload);
    // 文本作为纯文本出现(没被当 HTML 执行)
    await expect(webPage.locator('[data-testid^="msg-bubble-"]', { hasText: '<script>' }).last())
      .toBeVisible({ timeout: 10000 });
    // XSS 未执行
    expect(await webPage.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('EDGE-07 快速切换会话 → 不串消息/不崩', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginOpen(webPage, baseURL, seeded);
    // 在会话发一条带标记的消息
    const t = 'switch-' + Date.now();
    await chat.sendText(t);
    await chat.expectMessageVisible(t);
    // 反复回列表 + 重进会话 3 次(快速切换)
    for (let i = 0; i < 3; i++) {
      await webPage.locator('[data-testid="nav-tab-chats"]').first().click();
      await webPage.waitForTimeout(200);
      await chat.openConv(seeded.convAB);
    }
    // 重进后消息还在,输入框可用(没串没崩)
    await chat.expectMessageVisible(t);
    await expect(chat.tid('chat-msg-input')).toBeVisible();
  });
});
