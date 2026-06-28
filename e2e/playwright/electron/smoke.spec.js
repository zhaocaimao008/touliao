'use strict';
const base = require('@playwright/test');
const { launchElectron, skipReason } = require('./launch');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

const test = base.test;
const expect = base.expect;

/**
 * Electron 烟雾测试:复用 web 的 POM(同一 web/dist,锚点一致)。
 * 前置:npm run build:web。本机 headless 需 xvfb-run。
 * root 环境因 main.js enableSandbox() 限制会整体跳过(见 skipReason)。
 */
test.describe('Electron 桌面端', () => {
  let app, page, state;

  test.beforeAll(async () => {
    const reason = skipReason();
    test.skip(!!reason, reason || '');
    ({ app, page, state } = await launchElectron());
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('WIN-AUTH 登录成功 → 主界面', async () => {
    const login = new LoginPage(page);
    const chat = new ChatPage(page);
    const u = state.users[0];
    // Electron=HashRouter,reload 到登录页(localStorage 已注入后端地址)
    await page.reload();
    await login.tid(require('../../shared/anchors').loginPhone).waitFor({ state: 'visible', timeout: 15000 });
    await login.login(u.phone, u.password);
    await chat.waitReady();
  });

  test('WIN-CHAT 发送文本消息', async () => {
    const chat = new ChatPage(page);
    test.skip(!state.convAB, '无会话');
    await chat.openConv(state.convAB);
    const t = 'electron-e2e-' + Date.now();
    await chat.sendText(t);
    await chat.expectMessageVisible(t);
  });
});
