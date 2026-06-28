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
});

const expect = base.expect;
module.exports = { test, expect, loadState };
