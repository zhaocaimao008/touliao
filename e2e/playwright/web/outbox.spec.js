'use strict';
// ================================================================
// OUTBOX — 失败消息「待发件箱」自愈体验
//   OB-01 断网发送失败 → 刷新页面 → 消息仍在（localStorage 持久化）
//   OB-02 断网发送失败 → 网络恢复重连 → 自动重发并转为已发送（无需手点）
// ================================================================
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

test.describe('待发件箱 OUTBOX', () => {
  test('OB-01 失败消息刷新后仍在（持久化）', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const login = new LoginPage(webPage);
    const chat = new ChatPage(webPage);
    await login.gotoLogin(baseURL);
    await login.login(seeded.users[0].phone, seeded.users[0].password);
    await chat.waitReady();
    await chat.openConv(seeded.convAB);
    await chat.waitSocketConnected();   // 先确认连上,才是「已连上后断线」被测路径

    await webPage.context().setOffline(true);
    // 先确认 socket 真正断开再发消息:否则消息可能在离线切换生效前发出并 ack 成功,
    // 不会产生失败态(历史 flake 根因之一)。
    await chat.waitSocketDisconnected();
    const t = 'outbox-persist-' + Date.now();
    await chat.sendText(t);
    // 5s ack 超时(或 disconnect/发送自检即时标记) → 失败态。
    // 30s:CI 共享 runner 负载下 React 渲染队列被推迟,20s 窗口偶发不足(retries 3 全挂的历史 flake)
    await expect(webPage.locator('[data-testid="msg-send-failed"]').last())
      .toBeVisible({ timeout: 30000 });

    // 断网态下：失败消息已写入 localStorage 待发件箱（持久化的直接证据）
    const outboxRaw = await webPage.evaluate(
      (cid) => localStorage.getItem(`outbox_${cid}`), seeded.convAB);
    expect(outboxRaw, '待发件箱应已持久化失败消息').toContain(t);

    // 恢复网络后刷新页面（离线态无法加载 HTML）。刷新会清空内存 messages，
    // 若消息仍可见，即证明它是从 localStorage 待发件箱恢复出来的。
    await webPage.context().setOffline(false);
    await webPage.reload();
    await chat.waitReady();
    await chat.openConv(seeded.convAB);
    await expect(webPage.locator('[data-testid^="msg-bubble-"]', { hasText: t }).last())
      .toBeVisible({ timeout: 8000 });
  });

  test('OB-02 网络恢复后自动重发（失败态自愈）', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const login = new LoginPage(webPage);
    const chat = new ChatPage(webPage);
    await login.gotoLogin(baseURL);
    await login.login(seeded.users[0].phone, seeded.users[0].password);
    await chat.waitReady();
    await chat.openConv(seeded.convAB);
    await chat.waitSocketConnected();   // 先确认连上,才是「已连上后断线」被测路径

    await webPage.context().setOffline(true);
    // 同 OB-01:确认断开后再发送,保证必然进入失败态(消除离线切换生效前的发送竞态)
    await chat.waitSocketDisconnected();
    const t = 'outbox-heal-' + Date.now();
    await chat.sendText(t);
    await expect(webPage.locator('[data-testid="msg-send-failed"]').last())
      .toBeVisible({ timeout: 30000 });

    // 恢复网络 → socket 自动重连 → 失败消息自动重发
    await webPage.context().setOffline(false);
    // 自愈完成后失败标记应消失（该条已成功送达）;30s 吸收 CI 负载(同 OB-01)
    await expect(webPage.locator('[data-testid="msg-send-failed"]'))
      .toHaveCount(0, { timeout: 30000 });
    // 消息本身仍在
    await expect(webPage.locator('[data-testid^="msg-bubble-"]', { hasText: t }).last())
      .toBeVisible();
  });
});
