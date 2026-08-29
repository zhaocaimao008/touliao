'use strict';
// CALL-E2E：真正的 A↔B 双端语音通话互通验证（不是只看自己这边通话窗弹出来）。
// A 发起 → B 收到来电(头像/昵称/接听/拒绝按钮齐全) → B 接听 → 双方 RTCPeerConnection
// 都进入 connected（用 UI 上的计时器/状态文案作为可观察证据）→ 挂断 → 双方都回到无通话状态。
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone', 'camera'],
});

test.describe('通话真实互通(A/B 双上下文)', () => {
  test('CALL-E2E-01 A呼叫B → B看到来电 → B接听 → 双方进入connected → A挂断 → 双方回到无通话', async ({ webPage, makeCtx, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');

    // A：复用 webPage fixture 自带的 context
    const loginA = new LoginPage(webPage);
    const chatA = new ChatPage(webPage);
    await loginA.gotoLogin(baseURL);
    await loginA.login(seeded.users[0].phone, seeded.users[0].password);
    await chatA.waitReady();

    // B：独立 context + 独立登录（seeded.users[1] 对应 convAB 的另一方）
    const ctxB = await makeCtx();
    const pageB = await ctxB.newPage();
    await pageB.context().grantPermissions(['microphone', 'camera']);
    const loginB = new LoginPage(pageB);
    await loginB.gotoLogin(baseURL);
    await loginB.login(seeded.users[1].phone, seeded.users[1].password);
    // B 不需要打开具体会话——来电监听是全局的（Home.jsx），登录即可收到。
    // 排查用：给 socket 连接 + 加入 user_房间留出余量，避免时序竞争误判成真实bug。
    await pageB.waitForTimeout(2000);

    // A 打开与 B 的会话并发起语音通话
    await chatA.openConv(seeded.convAB);
    await chatA.startCall('audio');
    await expect(webPage.locator('[data-testid="call-modal"]')).toBeVisible();

    // B 侧应该出现来电：头像+昵称+接听+拒绝按钮
    const incomingModalB = pageB.locator('[data-testid="call-modal"]');
    await expect(incomingModalB).toBeVisible({ timeout: 10000 });
    await expect(pageB.locator('[data-testid="call-accept-btn"]')).toBeVisible();
    await expect(pageB.locator('[data-testid="call-reject-btn"]')).toBeVisible();

    // B 接听
    await pageB.locator('[data-testid="call-accept-btn"]').click();

    // 双方都应该进入 connected（UI 上表现为计时器 mm:ss 文案出现，取代"等待接听/连接中"）
    const timerRe = /^\d{2}:\d{2}(:\d{2})?$/;
    await expect(async () => {
      const textA = await webPage.locator('.cm-voice-status').first().innerText();
      expect(textA.trim()).toMatch(timerRe);
    }).toPass({ timeout: 20000 });
    await expect(async () => {
      const textB = await pageB.locator('.cm-voice-status').first().innerText();
      expect(textB.trim()).toMatch(timerRe);
    }).toPass({ timeout: 20000 });

    // 静音：B 点击静音按钮，按钮态应切到"取消静音"（真实 audio track.enabled 由组件内部维护，
    // 这里验证的是 UI 状态与用户操作正确联动，不是伪装成静音的音量清零）。
    const muteBtnB = pageB.getByRole('button', { name: '静音' });
    await muteBtnB.click();
    await expect(pageB.getByRole('button', { name: '取消静音' })).toBeVisible({ timeout: 3000 });

    // A 挂断 → 双方 call-modal 都应消失
    await chatA.hangup();
    await expect(webPage.locator('[data-testid="call-modal"]')).toBeHidden({ timeout: 10000 });
    await expect(incomingModalB).toBeHidden({ timeout: 10000 });

    await pageB.close();
  });

  test('CALL-E2E-02 B拒绝来电 → A立即收到"对方已拒绝"并结束呼叫（不再继续响铃）', async ({ webPage, makeCtx, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');

    const loginA = new LoginPage(webPage);
    const chatA = new ChatPage(webPage);
    await loginA.gotoLogin(baseURL);
    await loginA.login(seeded.users[0].phone, seeded.users[0].password);
    await chatA.waitReady();

    const ctxB = await makeCtx();
    const pageB = await ctxB.newPage();
    await pageB.context().grantPermissions(['microphone', 'camera']);
    const loginB = new LoginPage(pageB);
    await loginB.gotoLogin(baseURL);
    await loginB.login(seeded.users[1].phone, seeded.users[1].password);
    await pageB.waitForTimeout(2000);

    await chatA.openConv(seeded.convAB);
    await chatA.startCall('audio');
    const incomingModalB = pageB.locator('[data-testid="call-modal"]');
    await expect(incomingModalB).toBeVisible({ timeout: 10000 });

    // B 拒绝
    await pageB.locator('[data-testid="call-reject-btn"]').click();

    // A 侧必须立即看到"对方已拒绝"并结束呼叫状态，不能继续显示"呼叫中"/响铃
    await expect(webPage.getByText('对方已拒绝').first()).toBeVisible({ timeout: 5000 });
    await expect(webPage.locator('[data-testid="call-modal"]')).toBeHidden({ timeout: 10000 });
    // B 侧来电弹窗也应已收起
    await expect(incomingModalB).toBeHidden({ timeout: 5000 });

    await pageB.close();
  });

  test('CALL-E2E-03 接通后由B挂断 → A也立即结束通话（非发起方挂断同样生效）', async ({ webPage, makeCtx, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');

    const loginA = new LoginPage(webPage);
    const chatA = new ChatPage(webPage);
    await loginA.gotoLogin(baseURL);
    await loginA.login(seeded.users[0].phone, seeded.users[0].password);
    await chatA.waitReady();

    const ctxB = await makeCtx();
    const pageB = await ctxB.newPage();
    await pageB.context().grantPermissions(['microphone', 'camera']);
    const loginB = new LoginPage(pageB);
    await loginB.gotoLogin(baseURL);
    await loginB.login(seeded.users[1].phone, seeded.users[1].password);
    await pageB.waitForTimeout(2000);

    await chatA.openConv(seeded.convAB);
    await chatA.startCall('audio');
    const incomingModalB = pageB.locator('[data-testid="call-modal"]');
    await expect(incomingModalB).toBeVisible({ timeout: 10000 });
    await pageB.locator('[data-testid="call-accept-btn"]').click();

    const timerRe = /^\d{2}:\d{2}(:\d{2})?$/;
    await expect(async () => {
      const textB = await pageB.locator('.cm-voice-status').first().innerText();
      expect(textB.trim()).toMatch(timerRe);
    }).toPass({ timeout: 20000 });

    // B（非发起方）挂断
    await pageB.locator('[data-testid="call-hangup-btn"]').click();

    // A 侧也应立即结束，不能停留在"通话中"
    await expect(webPage.locator('[data-testid="call-modal"]')).toBeHidden({ timeout: 10000 });
    await expect(incomingModalB).toBeHidden({ timeout: 10000 });

    await pageB.close();
  });
});
