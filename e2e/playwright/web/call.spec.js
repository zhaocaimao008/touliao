'use strict';
const { test, expect } = require('../fixtures');
const { LoginPage } = require('../pages/LoginPage');
const { ChatPage } = require('../pages/ChatPage');

// 通话需要 getUserMedia;用 chromium fake media 设备,不弹权限/不需真硬件
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',     // 自动授予麦克风/摄像头权限
      '--use-fake-device-for-media-stream', // 用假音视频源
    ],
  },
  permissions: ['microphone', 'camera'],
});

async function loginOpen(webPage, baseURL, seeded) {
  const login = new LoginPage(webPage);
  const chat = new ChatPage(webPage);
  await login.gotoLogin(baseURL);
  await login.login(seeded.users[0].phone, seeded.users[0].password);
  await chat.waitReady();
  await chat.openConv(seeded.convAB);
  // 呼叫依赖实时 socket:未连上时 call:request 的 emit 只进缓冲、后端收不到 → ack 永不回,
  // call-modal 永不出现(全量负载下登录-开聊-点呼叫的窗口里 socket 常未就绪,稳定 flake)。
  await chat.waitSocketConnected();
  return chat;
}

test.describe('通话(仅 UI/signaling,不验媒体流)', () => {
  test('CALL-01 发起语音通话 → 通话窗出现 → 挂断', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginOpen(webPage, baseURL, seeded);
    await chat.startCall('audio');          // call-modal 出现(等 ack,20s 窗口)
    await expect(webPage.locator('[data-testid="call-modal"]')).toBeVisible({ timeout: 20000 });
    await chat.hangup();                     // 挂断 → 通话窗关闭
    await expect(webPage.locator('[data-testid="call-modal"]')).toBeHidden({ timeout: 10000 });
  });

  test('CALL-02 发起视频通话 → 通话窗出现', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginOpen(webPage, baseURL, seeded);
    await chat.startCall('video');
    await expect(webPage.locator('[data-testid="call-modal"]')).toBeVisible({ timeout: 20000 });
    await chat.hangup().catch(() => {});
  });
});
