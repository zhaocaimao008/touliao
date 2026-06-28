'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

async function loginA(webPage, baseURL, seeded) {
  const login = new LoginPage(webPage);
  const chat = new ChatPage(webPage);
  await login.gotoLogin(baseURL);
  await login.login(seeded.users[0].phone, seeded.users[0].password);
  await chat.waitReady();
  return chat;
}

test.describe('群管理 GRP', () => {
  test('GRP-01/02 建群 → 群发文本', async ({ webPage, seeded, baseURL }) => {
    // A 与 B 是好友(seed 已建),用 B 作群成员建群
    const B = seeded.users[1];
    const chat = await loginA(webPage, baseURL, seeded);
    const gname = 'grp-' + Date.now();
    await chat.createGroup(gname, [B.id]);
    // 进群后发文本
    const t = 'grpmsg-' + Date.now();
    await chat.sendText(t);
    await chat.expectMessageVisible(t);
  });

  test('GRP-05 退群 → 会话从列表移除', async ({ webPage, seeded, baseURL }) => {
    const B = seeded.users[1];
    const chat = await loginA(webPage, baseURL, seeded);
    const gname = 'grpleave-' + Date.now();
    await chat.createGroup(gname, [B.id]);
    // 打开群信息 → 退群
    await chat.openGroupInfo();
    await chat.leaveGroup();
    // 退群后回到列表,该群不再出现(标题不含 gname)
    await webPage.waitForTimeout(1500);
    await expect(webPage.locator('[data-testid^="conv-item-"]', { hasText: gname }))
      .toHaveCount(0, { timeout: 10000 });
  });
});
