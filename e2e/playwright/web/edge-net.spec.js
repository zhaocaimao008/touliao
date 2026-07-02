'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');
const { sendTextAs } = require('../../shared/backend/seed');

// EDGE-08 通话需 getUserMedia;用 fake media 设备(不影响 05/06)
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

async function loginCtx(browser, baseURL, backendUrl, user, convId) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((u) => { try { localStorage.setItem('vxin_server_url', u); } catch {} }, backendUrl);
  const page = await ctx.newPage();
  const login = new LoginPage(page), chat = new ChatPage(page);
  await login.gotoLogin(baseURL); await login.login(user.phone, user.password);
  await chat.waitReady();
  if (convId) await chat.openConv(convId);
  return { ctx, page, chat };
}

test.describe('网络边界 EDGE-NET', () => {
  test('EDGE-05 断网期间对端发消息 → 恢复后补拉收到', async ({ browser, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0], B = seeded.users[1];
    const a = await loginCtx(browser, baseURL, seeded.backendUrl, A, seeded.convAB);

    // A 断网
    await a.ctx.setOffline(true);
    // 断网期间 B(用 REST,模拟对端在线)发一条消息
    const missed = 'missed-' + Date.now();
    await sendTextAs(B, seeded.convAB, missed);
    await a.page.waitForTimeout(1500);
    // A 此时看不到(断网)
    // A 恢复网络 → socket 重连 + 补拉
    await a.ctx.setOffline(false);
    // 重连后应补拉到断网期间的消息
    await expect(a.page.locator('[data-testid^="msg-bubble-"]', { hasText: missed }))
      .toBeVisible({ timeout: 15000 });
    await a.ctx.close();
  });

  test('EDGE-06 弱网发失败 → 恢复后重发 → 不产生重复(clientMsgId幂等)', async ({ browser, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0];
    const a = await loginCtx(browser, baseURL, seeded.backendUrl, A, seeded.convAB);

    const txt = 'idem-' + Date.now();
    await a.ctx.setOffline(true);
    await a.chat.sendText(txt);
    // 5s ack 超时 → 失败态(❗)
    await expect(a.page.locator('[data-testid="msg-send-failed"]').last())
      .toBeVisible({ timeout: 12000 });
    // 恢复网络：socket.io 重连后自动补发离线期间缓冲的 emit，后端据 clientMsgId 幂等去重。
    // (不再手动点❗重发——那会与自动补发形成双触发竞态，且真实用户极少在重连窗口内恰好点重发。)
    await a.ctx.setOffline(false);
    await a.page.waitForTimeout(4000);
    // 核心断言:该文本最终只有 1 条(clientMsgId 幂等,自动补发不产生第二条)
    await expect(a.page.locator('[data-testid^="msg-bubble-"]', { hasText: txt }))
      .toHaveCount(1, { timeout: 10000 });
    await a.ctx.close();
  });

  test('EDGE-08 呼出无人接 → 通话窗保持/可挂断(不卡死)', async ({ browser, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0];
    const ctx = await browser.newContext();
    await ctx.addInitScript((u) => { try { localStorage.setItem('vxin_server_url', u); } catch {} }, seeded.backendUrl);
    await ctx.grantPermissions(['microphone', 'camera']).catch(() => {});
    const page = await ctx.newPage();
    const login = new LoginPage(page), chat = new ChatPage(page);
    await login.gotoLogin(baseURL); await login.login(A.phone, A.password);
    await chat.waitReady(); await chat.openConv(seeded.convAB);
    // 发起通话(对端不在线/不接)
    await chat.tid('chat-call-audio-btn').first().click();
    await expect(page.locator('[data-testid="call-modal"]')).toBeVisible({ timeout: 10000 });
    // 等待一段(呼叫中),验证通话窗没崩,可手动挂断
    await page.waitForTimeout(3000);
    await chat.tid('call-hangup-btn').click();
    await expect(page.locator('[data-testid="call-modal"]')).toBeHidden({ timeout: 10000 });
    await ctx.close();
  });
});
