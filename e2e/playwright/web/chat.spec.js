'use strict';
const path = require('path');
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

test.describe('单聊 CHAT', () => {
  test.skip(({}, testInfo) => false, '');

  test('CHAT-02 发送文本消息 → 气泡出现', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话(建会话失败)');
    const chat = await loginAndOpenConv(webPage, baseURL, seeded);
    const text = 'e2e-hello-' + Date.now();
    await chat.sendText(text);
    await chat.expectMessageVisible(text);
  });

  test('CHAT-05 发送图片 → 图片气泡出现', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginAndOpenConv(webPage, baseURL, seeded);
    // 用仓库内已有的小图作为上传素材
    const img = path.join(__dirname, '..', '..', 'fixtures', 'sample.png');
    await chat.sendImage(img);
    // 图片消息渲染(走本地上传回退,后端入库广播)
    await webPage.locator('[data-testid="msg-image"]').last().waitFor({ state: 'visible', timeout: 15000 });
  });
});
