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
    // 打开账户面板,应能看到两个账号行。
    // 轮询里不盲目 toggle:先确保面板处于打开态(account-add-row 可见)再数行数,
    // 避免「面板已开→再点=关闭」的自锁 toggle(全量负载下 reload/首帧慢时稳定 flake)。
    const switcher = webPage.locator('[data-testid="account-switcher"]');
    const rows = webPage.locator('[data-testid^="account-row-"]');
    const addRow = webPage.locator('[data-testid="account-add-row"]');
    await expect(async () => {
      if (!(await addRow.isVisible().catch(() => false))) {
        await switcher.click();
        await webPage.waitForTimeout(300);
      }
      expect(await rows.count()).toBe(2);
    }).toPass({ timeout: 15000 });
  });
});
