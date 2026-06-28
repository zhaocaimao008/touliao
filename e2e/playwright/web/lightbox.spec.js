'use strict';
const path = require('path');
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

test.describe('灯箱画廊', () => {
  test('LB-01 点图片打开灯箱 → Esc 关闭', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginOpen(webPage, baseURL, seeded);
    await chat.sendImage(path.join(__dirname, '..', '..', 'fixtures', 'sample.png'));
    await webPage.locator('[data-testid="msg-image"]').last().waitFor({ state: 'visible', timeout: 15000 });
    await chat.openLastImageLightbox();
    await expect(webPage.locator('[data-testid="lightbox"]')).toBeVisible();
    await chat.lightboxCloseByKey();
    await expect(webPage.locator('[data-testid="lightbox"]')).toBeHidden();
  });

  test('LB-02 多图画廊 → 右键切换到下一张', async ({ webPage, seeded, baseURL }) => {
    test.skip(!seeded.convAB, '无会话');
    const chat = await loginOpen(webPage, baseURL, seeded);
    // 发两张图(用不同素材区分)
    await chat.sendImage(path.join(__dirname, '..', '..', 'fixtures', 'sample.png'));
    await webPage.waitForTimeout(800);
    await chat.sendImage(path.join(__dirname, '..', '..', 'fixtures', 'sample2.png'));
    await webPage.locator('[data-testid="msg-image"]').nth(1).waitFor({ state: 'visible', timeout: 15000 });
    // 打开第一张
    await webPage.locator('[data-testid="msg-image"]').first().click();
    await expect(webPage.locator('[data-testid="lightbox"]')).toBeVisible();
    const src1 = await chat.lightboxImageSrc();
    await chat.lightboxNextByKey();
    await webPage.waitForTimeout(400);
    const src2 = await chat.lightboxImageSrc();
    // 画廊翻页:切换后大图 src 变化(此前 bug:画廊恒空只能看单张)
    expect(src2).not.toBe(src1);
  });
});
