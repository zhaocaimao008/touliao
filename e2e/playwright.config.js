// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');
const env = require('./shared/env');

/**
 * 两个 project:
 *  - web:     用 chromium 打开 vite preview(或 dipsin.com),localStorage 注入测试后端地址
 *  - electron: 用 _electron 启动 desktop-electron(loadFile web/dist),复用 web 的 POM
 * globalSetup 起隔离 backend-v2 + 造号,globalTeardown 关闭。
 */
module.exports = defineConfig({
  testDir: './playwright',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,        // 共享一个后端实例,串行避免数据互相干扰
  workers: 1,
  // CI 重试 3 次：outbox / edge-net / read 等用例依赖「断网 5s ack 超时 → 失败态」
  // 或跨端 socket 广播（已读/新消息回执）的时序。经定位确认:这类用例隔离跑 100% 稳过
  // （CHAT-04 / OB / CHAT-09 各连跑 6/6），失败只发生在 35 用例串行 + 共享单后端 + runner
  // 负载抖动下——socket 事件与客户端 5s 计时器被主线程/网络竞争推迟，单条耗时可翻倍。
  // 属基础设施时序 flake，非产品缺陷。重试仅吸收瞬时抖动；真实回归会连挂全部尝试照样红。
  // 已配套修复:(1) 多端用例 context 经 makeCtx fixture 兜底关闭,杜绝失败泄漏 socket 拖慢
  // 后续用例的级联;(2) CHAT-04 先等 B 加载到 A 的消息再断言已读,消除历史读位竞态。
  // 本地默认不重试便于定位。
  retries: process.env.CI ? 3 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: require.resolve('./playwright/global-setup.js'),
  globalTeardown: require.resolve('./playwright/global-teardown.js'),

  projects: [
    {
      name: 'web',
      testMatch: /playwright\/web\/.*\.spec\.js/,
      use: {
        baseURL: env.WEB_URL,
        headless: true,
        viewport: { width: 1280, height: 800 },
        actionTimeout: 10_000,
        trace: 'retain-on-failure',
      },
    },
    {
      name: 'electron',
      testMatch: /playwright\/electron\/.*\.spec\.js/,
      // electron project 不用 chromium,launch 在 spec 里通过 _electron 完成
      use: { trace: 'retain-on-failure' },
    },
  ],
});
