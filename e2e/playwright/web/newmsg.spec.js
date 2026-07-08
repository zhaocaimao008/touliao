'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

/**
 * 「N 条新消息」悬浮提示：A 上翻看历史时 B 发来消息 → A 端出现「回到底部」按钮 +
 * 「N 条新消息」角标；点按滚到底后清零。用两个 browser context 模拟两端。
 */
test.describe('新消息悬浮提示 NEWMSG', () => {
  test('NEWMSG-01 上翻看历史 → 出现回到底部按钮', async ({ browser, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0];
    const inject = (ctx) => ctx.addInitScript((url) => {
      try { localStorage.setItem('vxin_server_url', url); } catch {}
    }, seeded.backendUrl);

    const ctxA = await browser.newContext();
    await inject(ctxA);
    const pageA = await ctxA.newPage();
    const loginA = new LoginPage(pageA), chatA = new ChatPage(pageA);
    await loginA.gotoLogin(baseURL); await loginA.login(A.phone, A.password);
    await chatA.waitReady(); await chatA.openConv(seeded.convAB);

    // 造出可滚动的历史(>300px)：连发多条
    for (let i = 0; i < 20; i++) await chatA.sendText(`hist-${i}-${Date.now()}`);
    await pageA.waitForTimeout(300);

    // 上翻离开底部 → 「回到底部」按钮出现
    await chatA.scrollMessagesUp();   // 滚到顶
    const m = await chatA.scrollMetrics();
    test.skip(m.scrollHeight <= m.clientHeight + 300, `列表不足以滚动(dist=${m.distFromBottom})`);
    await expect.poll(() => chatA.scrollBottomBtnVisible(), { timeout: 5000 }).toBe(true);

    await ctxA.close();
  });

  test('NEWMSG-02 看历史时对方发来 → 角标计数，点按回底清零', async ({ browser, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0], B = seeded.users[1];
    const inject = (ctx) => ctx.addInitScript((url) => {
      try { localStorage.setItem('vxin_server_url', url); } catch {}
    }, seeded.backendUrl);

    // A 端
    const ctxA = await browser.newContext();
    await inject(ctxA);
    const pageA = await ctxA.newPage();
    const loginA = new LoginPage(pageA), chatA = new ChatPage(pageA);
    await loginA.gotoLogin(baseURL); await loginA.login(A.phone, A.password);
    await chatA.waitReady(); await chatA.openConv(seeded.convAB);
    for (let i = 0; i < 20; i++) await chatA.sendText(`base-${i}-${Date.now()}`);
    await pageA.waitForTimeout(300);
    await chatA.scrollMessagesUp();   // 滚到顶
    const mA = await chatA.scrollMetrics();
    test.skip(mA.scrollHeight <= mA.clientHeight + 300, `列表不足以滚动(dist=${mA.distFromBottom})`);
    await expect.poll(() => chatA.scrollBottomBtnVisible(), { timeout: 5000 }).toBe(true);

    // B 端登录并打开同一私聊，发一条 → A 看历史中应累计「新消息」角标
    const ctxB = await browser.newContext();
    await inject(ctxB);
    const pageB = await ctxB.newPage();
    const loginB = new LoginPage(pageB), chatB = new ChatPage(pageB);
    await loginB.gotoLogin(baseURL); await loginB.login(B.phone, B.password);
    await chatB.waitReady();
    const target = pageB.locator('[data-testid^="conv-item-"]', { hasText: 'Alice' }).first();
    if (await target.count()) await target.click();
    else await chatB.openFirstConv();
    await pageB.locator('[data-testid="chat-msg-input"]').waitFor({ state: 'visible' });
    await chatB.sendText('newmsg-ping-' + Date.now());

    // A 端出现「N 条新消息」角标
    await expect.poll(() => chatA.newMsgBadgeText(), { timeout: 15000 }).toContain('新消息');

    // 点回底 → 角标消失
    await chatA.clickScrollBottom();
    await expect.poll(() => chatA.newMsgBadgeText(), { timeout: 5000 }).toBe('');

    await ctxA.close(); await ctxB.close();
  });
});
