'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');
const { sendTextAs } = require('../../shared/backend/seed');

// EDGE-08 通话需 getUserMedia;用 fake media 设备(不影响 05/06)
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

// context 由 makeCtx 创建并兜底关闭(失败也不泄漏 socket);此处只负责登录+开会话
async function loginCtx(makeCtx, baseURL, user, convId, grantMedia = false) {
  const ctx = await makeCtx();
  if (grantMedia) await ctx.grantPermissions(['microphone', 'camera']).catch(() => {});
  const page = await ctx.newPage();
  const login = new LoginPage(page), chat = new ChatPage(page);
  await login.gotoLogin(baseURL); await login.login(user.phone, user.password);
  await chat.waitReady();
  if (convId) await chat.openConv(convId);
  return { ctx, page, chat };
}

test.describe('网络边界 EDGE-NET', () => {
  test('EDGE-05 断网期间对端发消息 → 恢复后补拉收到', async ({ makeCtx, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0], B = seeded.users[1];
    const a = await loginCtx(makeCtx, baseURL, A, seeded.convAB);

    // 先确保 socket 已连上再断网——测「已连上后断线补拉」,非冷启动从未连上
    await a.chat.waitSocketConnected();
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
  });

  test('EDGE-06 弱网发失败 → 恢复后重发 → 不产生重复(clientMsgId幂等)', async ({ makeCtx, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0];
    const a = await loginCtx(makeCtx, baseURL, A, seeded.convAB);

    // 先确保 socket 已连上再断网——测「已连上后弱网发」,非冷启动从未连上
    await a.chat.waitSocketConnected();
    const txt = 'idem-' + Date.now();
    await a.ctx.setOffline(true);
    await a.chat.sendText(txt);
    // 弱网发送:消息不能被静默丢弃——乐观气泡必须立刻可见(无论后续走失败态❗还是
    // socket.io 缓冲重连后自动补发成功;二者都可接受,不做脆弱的「必须进失败态」硬断言,
    // 因为 socket.io 离线缓冲可能在 5s 内经瞬时重连即把消息送达,失败态未必出现)。
    await expect(a.page.locator('[data-testid^="msg-bubble-"]', { hasText: txt }).last())
      .toBeVisible({ timeout: 20000 });
    // 恢复网络：socket.io 重连后自动补发离线期间缓冲的 emit / outbox 自愈重发，
    // 后端据 clientMsgId 幂等去重。(不手动点❗重发——会与自动补发形成双触发竞态。)
    await a.ctx.setOffline(false);
    // 等 socket 真正重连上再校验幂等,否则自愈重发可能尚未完成→偶发 0 条(flaky)。
    await a.chat.waitSocketConnected();
    // 核心断言(幂等):该文本最终恰好 1 条——既不因自动补发+outbox 自愈双触发而重复(≤1),
    // 也不因重连补拉误删乐观消息而丢失(≥1)。用 toHaveCount 轮询等待自愈落定。
    await expect(a.page.locator('[data-testid^="msg-bubble-"]', { hasText: txt }))
      .toHaveCount(1, { timeout: 15000 });
  });

  test('EDGE-08 呼出无人接 → 通话窗保持/可挂断(不卡死)', async ({ makeCtx, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const A = seeded.users[0];
    const a = await loginCtx(makeCtx, baseURL, A, seeded.convAB, /* grantMedia */ true);
    const { page, chat } = a;
    // 发起通话(对端不在线/不接)
    await chat.tid('chat-call-audio-btn').first().click();
    await expect(page.locator('[data-testid="call-modal"]')).toBeVisible({ timeout: 10000 });
    // 等待一段(呼叫中),验证通话窗没崩,可手动挂断
    await page.waitForTimeout(3000);
    await chat.tid('call-hangup-btn').click();
    await expect(page.locator('[data-testid="call-modal"]')).toBeHidden({ timeout: 10000 });
  });
});
