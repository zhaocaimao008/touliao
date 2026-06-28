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
  retries: 0,
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
