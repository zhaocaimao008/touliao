'use strict';
// ================================================================
// IME — 中文输入法组词保护
//   IME-01 组词中(isComposing)按 Enter 不发送,只有组词结束后 Enter 才发送
// ================================================================
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

test.describe('输入法组词保护 IME', () => {
  test('IME-01 组词中 Enter 不误发', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const login = new LoginPage(webPage);
    const chat = new ChatPage(webPage);
    await login.gotoLogin(baseURL);
    await login.login(seeded.users[0].phone, seeded.users[0].password);
    await chat.waitReady();
    await chat.openConv(seeded.convAB);

    const input = webPage.locator('[data-testid="chat-msg-input"]');
    await input.fill('拼音组词中');

    // 模拟 IME 组词态下按 Enter：派发 isComposing=true 的 keydown。
    // 期望：被守卫拦截，不发送，输入框内容保留。
    await input.evaluate((el) => {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'isComposing', { get: () => true });
      Object.defineProperty(ev, 'keyCode', { get: () => 229 });
      el.dispatchEvent(ev);
    });
    await webPage.waitForTimeout(300);
    await expect(input).toHaveValue('拼音组词中');   // 未被清空 = 未发送

    // 组词结束后正常 Enter → 发送,输入框清空,气泡出现
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(webPage.locator('[data-testid^="msg-bubble-"]', { hasText: '拼音组词中' }).last())
      .toBeVisible({ timeout: 5000 });
  });
});
