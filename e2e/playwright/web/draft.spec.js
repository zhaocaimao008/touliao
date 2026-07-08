'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

// A 登录后打开与 B 的会话
async function loginAndOpenConv(webPage, baseURL, seeded) {
  const login = new LoginPage(webPage);
  const chat = new ChatPage(webPage);
  await login.gotoLogin(baseURL);
  await login.login(seeded.users[0].phone, seeded.users[0].password);
  await chat.waitReady();
  if (seeded.convAB) await chat.openConv(seeded.convAB);
  else await chat.openFirstConv();
  return chat;
}

test.describe('输入草稿 DRAFT', () => {
  test('DRAFT-01 输入未发送 → 列表显示「[草稿]」标记', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话(建会话失败)');
    const chat = await loginAndOpenConv(webPage, baseURL, seeded);
    const text = 'e2e-draft-' + Date.now();
    await chat.typeText(text);
    // 草稿写入 localStorage 并派发事件 → 列表项出现「[草稿]」标记
    await expect.poll(() => chat.draftMarkVisible(seeded.convAB), { timeout: 5000 }).toBe(true);
  });

  test('DRAFT-02 清空输入 → 「[草稿]」标记消失', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginAndOpenConv(webPage, baseURL, seeded);
    await chat.typeText('临时草稿');
    await expect.poll(() => chat.draftMarkVisible(seeded.convAB), { timeout: 5000 }).toBe(true);
    await chat.typeText('');   // 清空
    await expect.poll(() => chat.draftMarkVisible(seeded.convAB), { timeout: 5000 }).toBe(false);
  });

  test('DRAFT-03 发送后 → 草稿清除、输入框清空、标记消失', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginAndOpenConv(webPage, baseURL, seeded);
    const text = 'e2e-draft-send-' + Date.now();
    await chat.typeText(text);
    await expect.poll(() => chat.draftMarkVisible(seeded.convAB), { timeout: 5000 }).toBe(true);
    await chat.sendText(text);   // fill 会复写同值后发送
    await chat.expectMessageVisible(text);
    await expect.poll(() => chat.inputValue(), { timeout: 5000 }).toBe('');
    await expect.poll(() => chat.draftMarkVisible(seeded.convAB), { timeout: 5000 }).toBe(false);
  });
});
