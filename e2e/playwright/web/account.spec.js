'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

test.describe('账户', () => {
  test('AUTH-06 登出 → 回到登录页', async ({ webPage, seeded, baseURL }) => {
    const login = new LoginPage(webPage);
    const chat = new ChatPage(webPage);
    await login.gotoLogin(baseURL);
    await login.login(seeded.users[0].phone, seeded.users[0].password);
    await chat.waitReady();
    // 打开账户切换面板 → 点当前账号登出 → 确认弹窗
    await webPage.locator('[data-testid="account-switcher"]').click();
    await webPage.locator('[data-testid="account-logout-btn"]').click();
    await webPage.locator('[data-testid="confirm-ok"]').click().catch(() => {});
    // 回到登录页(登录输入框重新可见)
    await expect(webPage.locator('[data-testid="login-phone-input"]'))
      .toBeVisible({ timeout: 10000 });
  });
});
