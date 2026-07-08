'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

test.describe('网络异常 NET', () => {
  test('NET-01 断网发消息 → 显示发送失败;NET-02 恢复后重连', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const login = new LoginPage(webPage);
    const chat = new ChatPage(webPage);
    await login.gotoLogin(baseURL);
    await login.login(seeded.users[0].phone, seeded.users[0].password);
    await chat.waitReady();
    await chat.openConv(seeded.convAB);

    // 断网
    await webPage.context().setOffline(true);
    const t = 'net-' + Date.now();
    await chat.sendText(t);
    // socket ack 5s 超时后乐观消息标记 error(❗)
    await expect(webPage.locator('[data-testid="msg-send-failed"]').last())
      .toBeVisible({ timeout: 12000 });

    // NET-02 恢复网络(socket 自动重连)
    await webPage.context().setOffline(false);
    await webPage.waitForTimeout(3000);
    // 重连后会话列表/状态恢复:输入框仍可用(界面没卡死)
    await expect(webPage.locator('[data-testid="chat-msg-input"]')).toBeVisible();
  });

  test('NET-03 断开>2s→显示重连条;恢复后闪现「网络已恢复」', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const login = new LoginPage(webPage);
    const chat = new ChatPage(webPage);
    await login.gotoLogin(baseURL);
    await login.login(seeded.users[0].phone, seeded.users[0].password);
    await chat.waitReady();
    await chat.openConv(seeded.convAB);

    // 断开 > 2s → 顶部出现「正在重连」黄条
    await webPage.context().setOffline(true);
    const banner = webPage.locator('[data-testid="net-banner"]');
    await expect(banner).toHaveAttribute('data-state', 'reconnecting', { timeout: 6000 });

    // 恢复 → 闪现绿色「网络已恢复」，随后自动收起
    await webPage.context().setOffline(false);
    await expect(banner).toHaveAttribute('data-state', 'restored', { timeout: 10000 });
    await expect(banner).toContainText('网络已恢复');
    // ~2s 后自动消失
    await expect(banner).toHaveCount(0, { timeout: 6000 });
  });
});
