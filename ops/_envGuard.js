#!/usr/bin/env node
'use strict';
/**
 * 环境指纹校验 —— 本机(45.77.131.33)同时跑着投聊(touliao)和另一个真实生产项目(vxin)，
 * 且两者默认端口/host混用过(3002/3003)，历史上多个测试脚本硬编码打 127.0.0.1:3002，
 * 一旦目标端口被另一个项目占用，脚本会在不知情的情况下向别人的生产环境写测试数据。
 *
 * 用法：在脚本最开头 require('./_envGuard').assertTouliaoBackend(BACKEND_URL)
 * 校验方式：GET {BACKEND_URL}/health，要求返回体里 service === 'touliao-backend'。
 * 不匹配/请求失败一律直接 process.exit(1)，不放行。
 */
const http = require('http');
const https = require('https');

function assertTouliaoBackend(backendUrl) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL('/health', backendUrl); } catch {
      console.error(`❌ 环境校验失败：BACKEND_URL 不是合法地址 (${backendUrl})`);
      process.exit(1);
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { timeout: 5000 }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch { body = null; }
        if (body && body.service === 'touliao-backend') {
          resolve(true);
          return;
        }
        console.error(`❌ 环境校验失败：${url} 返回的不是投聊后端(service=${body?.service ?? '未知'})。`);
        console.error('   本机同时运行着其他项目的生产服务，为避免误伤，已拒绝继续执行。');
        console.error('   如果你确认目标就是投聊，请检查 BACKEND_URL/端口是否配错。');
        process.exit(1);
      });
    });
    req.on('timeout', () => { req.destroy(); console.error(`❌ 环境校验超时：${url} 无响应`); process.exit(1); });
    req.on('error', (e) => { console.error(`❌ 环境校验失败：无法连接 ${url} (${e.message})`); process.exit(1); });
  });
}

module.exports = { assertTouliaoBackend };
