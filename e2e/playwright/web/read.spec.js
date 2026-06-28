'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');
const { seedUsers } = require('../../shared/backend/seed');

/**
 * 已读回执:A 发消息 → B 在另一浏览器上下文登录并打开会话(触发已读) → A 端看到"已读"。
 * 用两个 browser context 模拟两端。
 */
test.describe('已读回执', () => {
  test('CHAT-04 A发消息 B读 → A端显示已读', async ({ browser, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0], B = seeded.users[1];
    const inject = async (ctx) => ctx.addInitScript((url) => {
      try { localStorage.setItem('vxin_server_url', url); } catch {}
    }, seeded.backendUrl);

    // A 端
    const ctxA = await browser.newContext();
    await inject(ctxA);
    const pageA = await ctxA.newPage();
    const loginA = new LoginPage(pageA), chatA = new ChatPage(pageA);
    await loginA.gotoLogin(baseURL); await loginA.login(A.phone, A.password);
    await chatA.waitReady(); await chatA.openConv(seeded.convAB);
    const text = 'read-' + Date.now();
    await chatA.sendText(text);
    await chatA.expectMessageVisible(text);

    // B 端登录并打开与 A 的会话(找含 A 的会话项;打开即触发已读上报)
    const ctxB = await browser.newContext();
    await inject(ctxB);
    const pageB = await ctxB.newPage();
    const loginB = new LoginPage(pageB), chatB = new ChatPage(pageB);
    await loginB.gotoLogin(baseURL); await loginB.login(B.phone, B.password);
    await chatB.waitReady();
    // B 视角会话 id 与 A 不同,打开名字含 A(AliceE2E)的会话,确保是同一私聊
    const target = pageB.locator('[data-testid^="conv-item-"]', { hasText: 'Alice' }).first();
    if (await target.count()) await target.click();
    else await chatB.openFirstConv();
    await pageB.waitForTimeout(500);
    // 在 B 端也滚到底,确保 markReadRef 触发(已读只在底部上报)
    await pageB.keyboard.press('End').catch(() => {});

    // A 端应出现已读状态(socket 回执有延迟,给足时间轮询)
    await expect(pageA.locator('[data-testid="msg-read-status"]').last())
      .toBeVisible({ timeout: 15000 });

    await ctxA.close(); await ctxB.close();
  });
});
