'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

test.describe('认证 AUTH', () => {
  test('AUTH-01 登录成功 → 进入主界面', async ({ webPage, seeded, baseURL }) => {
    const login = new LoginPage(webPage);
    const chat = new ChatPage(webPage);
    const u = seeded.users[0];
    await login.gotoLogin(baseURL);
    await login.login(u.phone, u.password);
    await chat.waitReady();                 // 导航 nav-tab-chats 可见 = 登录成功
  });

  test('AUTH-02 登录失败 → 错误提示', async ({ webPage, seeded, baseURL }) => {
    const login = new LoginPage(webPage);
    const u = seeded.users[0];
    await login.gotoLogin(baseURL);
    await login.login(u.phone, 'wrongpass123');
    await expect(webPage.locator('[data-testid="auth-error-text"]')).toBeVisible();
  });
});
