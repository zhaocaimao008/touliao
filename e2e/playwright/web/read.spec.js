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
  test('CHAT-04 A发消息 B读 → A端显示已读', async ({ makeCtx, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0], B = seeded.users[1];

    // A 端（context 由 makeCtx 兜底关闭,失败也不泄漏 socket）
    const ctxA = await makeCtx();
    const pageA = await ctxA.newPage();
    const loginA = new LoginPage(pageA), chatA = new ChatPage(pageA);
    await loginA.gotoLogin(baseURL); await loginA.login(A.phone, A.password);
    await chatA.waitReady(); await chatA.openConv(seeded.convAB);
    // 发消息前确保 A socket 已连上并入房间,否则 B 已读的 message_read 广播时 A 可能还没进房间→漏收(flaky)
    await chatA.waitSocketConnected();
    const text = 'read-' + Date.now();
    await chatA.sendText(text);
    await chatA.expectMessageVisible(text);

    // B 端登录并打开与 A 的会话(找含 A 的会话项;打开即触发已读上报)
    const ctxB = await makeCtx();
    const pageB = await ctxB.newPage();
    const loginB = new LoginPage(pageB), chatB = new ChatPage(pageB);
    await loginB.gotoLogin(baseURL); await loginB.login(B.phone, B.password);
    await chatB.waitReady();
    // B 视角会话 id 与 A 不同,打开名字含 A(AliceE2E)的会话,确保是同一私聊
    const target = pageB.locator('[data-testid^="conv-item-"]', { hasText: 'Alice' }).first();
    if (await target.count()) await target.click();
    else await chatB.openFirstConv();
    await chatB.waitSocketConnected();   // B 也等连上,确保已读上报能发出
    // 关键:先确认 B 已加载到 A 发的这条消息,再谈已读——否则 B 的 markRead 位点
    // 可能落在 A 消息之前(历史未拉到),A 端永远等不到"已读"(此前 CHAT-04 flaky 根因)。
    await chatB.expectMessageVisible(text);
    // 在 B 端也滚到底,确保 markReadRef 触发(已读只在底部上报)
    await pageB.keyboard.press('End').catch(() => {});

    // A 端应出现已读状态(socket 回执有延迟,给足时间轮询)
    await expect(pageA.locator('[data-testid="msg-read-status"]').last())
      .toBeVisible({ timeout: 15000 });
  });
});
