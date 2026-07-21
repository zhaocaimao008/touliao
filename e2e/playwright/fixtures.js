'use strict';
const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const env = require('../shared/env');

const STATE_FILE = path.join(__dirname, '..', '.e2e-state.json');
function loadState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

/**
 * 扩展 test:
 *  - seeded: globalSetup 造的账号 { users:[{username,phone,password,token,id}], backendUrl }
 *  - webPage: 已注入"后端地址=测试后端"的 page(每个 test 新建)
 * 注入手段:addInitScript 在任何脚本前写 localStorage.vxin_server_url,
 *   使 web 的 axios baseURL / socket 都指向测试后端(见 web/src/main.jsx, SocketContext)。
 */
const test = base.test.extend({
  seeded: async ({}, use) => {
    await use(loadState());
  },

  webPage: async ({ page, baseURL }, use) => {
    const { backendUrl } = loadState();
    await page.addInitScript((url) => {
      try { localStorage.setItem('vxin_server_url', url); } catch {}
    }, backendUrl);
    await use(page);
  },

  /**
   * makeCtx: 创建一个已注入"后端地址=测试后端"的 browser context。
   * 关键:本 fixture 记录所有创建的 context,并在 teardown 阶段(无论用例 pass/fail)统一关闭。
   *
   * 为何需要:多端用例(read/newmsg/title-badge/edge-net)此前手动 browser.newContext()
   * 且仅在用例末尾 close()——一旦断言在中途失败,close 不执行 → context 及其 socket 泄漏。
   * 全量套件共享单一后端 + CI retries=2 时,泄漏的活 socket 累积,广播扇出变慢,
   * 拖慢后续所有 socket 依赖用例 → 级联 flaky。用 fixture 兜底清理根除该放大器。
   */
  makeCtx: async ({ browser }, use) => {
    const { backendUrl } = loadState();
    const created = [];
    const make = async () => {
      const ctx = await browser.newContext();
      await ctx.addInitScript((url) => {
        try { localStorage.setItem('vxin_server_url', url); } catch {}
      }, backendUrl);
      created.push(ctx);
      return ctx;
    };
    await use(make);
    // teardown:pass/fail 都执行,防 socket 泄漏累积
    for (const ctx of created) { await ctx.close().catch(() => {}); }
  },
});

const expect = base.expect;
module.exports = { test, expect, loadState };
