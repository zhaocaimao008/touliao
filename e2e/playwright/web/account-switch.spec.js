'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

test.describe('账户切换 ACC', () => {
  test('ACC-01 添加第二账号 → 切换为新账号(不被登出)', async ({ webPage, seeded, baseURL }) => {
    const A = seeded.users[0], B = seeded.users[1];
    const login = new LoginPage(webPage);
    const chat = new ChatPage(webPage);
    // A 登录
    await login.gotoLogin(baseURL);
    await login.login(A.phone, A.password);
    await chat.waitReady();
    // 添加账号 B(登录并添加,会 reload)。验证"添加账户登出"bug 已修:不应回到登录页
    await chat.addAccount(B.phone, B.password);
    // reload 后应仍在主界面(已是 B,未被登出)
    await chat.waitReady();
    await webPage.waitForTimeout(1500); // 等 reload + 账号数据加载
    await expect(webPage.locator('[data-testid="login-phone-input"]')).toHaveCount(0);
    // 打开账户面板,应能看到两个账号行(switcher 是 toggle,确保打开)
    const switcher = webPage.locator('[data-testid="account-switcher"]');
    await switcher.click();
    const rows = webPage.locator('[data-testid^="account-row-"]');
    // 面板可能需 toggle 两次(若初始态不同),轮询到 2 行
    await expect(async () => {
      if (await rows.count() < 2) { await switcher.click(); await webPage.waitForTimeout(300); }
      expect(await rows.count()).toBe(2);
    }).toPass({ timeout: 10000 });
  });
});
