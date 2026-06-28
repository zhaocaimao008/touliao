'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

async function loginOpen(webPage, baseURL, seeded) {
  const login = new LoginPage(webPage);
  const chat = new ChatPage(webPage);
  await login.gotoLogin(baseURL);
  await login.login(seeded.users[0].phone, seeded.users[0].password);
  await chat.waitReady();
  await chat.openConv(seeded.convAB);
  return chat;
}

test.describe('编辑/撤回', () => {
  test('CHAT-08 编辑消息 → 显示已编辑 + 新文本', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginOpen(webPage, baseURL, seeded);
    const orig = 'edit-orig-' + Date.now();
    await chat.sendText(orig);
    await chat.expectMessageVisible(orig);
    const edited = 'edit-new-' + Date.now();
    await chat.editLast(edited);
    // 新文本出现 + 已编辑标记
    await chat.expectMessageVisible(edited);
    await expect(webPage.locator('[data-testid="msg-edited-flag"]').last()).toBeVisible();
  });

  test('CHAT-09 撤回消息 → 显示撤回提示', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginOpen(webPage, baseURL, seeded);
    const t = 'recall-' + Date.now();
    await chat.sendText(t);
    await chat.expectMessageVisible(t);
    await chat.recallLast();
    await expect(webPage.locator('[data-testid="msg-recalled"]').last())
      .toBeVisible({ timeout: 10000 });
  });
});
