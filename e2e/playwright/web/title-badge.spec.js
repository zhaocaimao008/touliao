'use strict';
// ================================================================
// TITLE — 浏览器标签页未读角标
//   TB-01 未打开会话时收到消息 → document.title 变「(N) v信」；读后复位
// ================================================================
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

test.describe('标签页未读角标 TITLE', () => {
  test('TB-01 未读→标题显示(N)，进会话读后复位', async ({ browser, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0], B = seeded.users[1];
    const inject = (ctx) => ctx.addInitScript((url) => {
      try { localStorage.setItem('vxin_server_url', url); } catch {}
    }, seeded.backendUrl);

    // A 端：登录后停在会话列表，不打开该会话
    const ctxA = await browser.newContext();
    await inject(ctxA);
    const pageA = await ctxA.newPage();
    const loginA = new LoginPage(pageA), chatA = new ChatPage(pageA);
    await loginA.gotoLogin(baseURL); await loginA.login(A.phone, A.password);
    await chatA.waitReady();
    // 基线：无未读 → 纯标题
    await expect.poll(() => pageA.title(), { timeout: 5000 }).toBe('v信');

    // B 端：登录并打开同一私聊，发一条
    const ctxB = await browser.newContext();
    await inject(ctxB);
    const pageB = await ctxB.newPage();
    const loginB = new LoginPage(pageB), chatB = new ChatPage(pageB);
    await loginB.gotoLogin(baseURL); await loginB.login(B.phone, B.password);
    await chatB.waitReady(); await chatB.openConv(seeded.convAB);
    await chatB.sendText('tb-' + Date.now());

    // A 端：未打开会话 → 标题出现未读角标
    await expect.poll(() => pageA.title(), { timeout: 8000 }).toMatch(/^\(\d+\) v信$/);

    // A 打开该会话读掉 → 标题复位
    await chatA.openConv(seeded.convAB);
    await expect.poll(() => pageA.title(), { timeout: 8000 }).toBe('v信');

    await ctxA.close(); await ctxB.close();
  });
});
