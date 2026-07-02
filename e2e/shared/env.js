/**
 * e2e 环境常量。隔离测试后端的端口/邀请码/密钥等。
 * 可被环境变量覆盖,方便 CI / 多套并行。
 */
'use strict';
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

module.exports = {
  REPO_ROOT,
  BACKEND_DIR: path.join(REPO_ROOT, 'backend-v2'),

  // 隔离测试后端
  BACKEND_PORT: parseInt(process.env.E2E_BACKEND_PORT || '3099', 10),
  BACKEND_HOST: '127.0.0.1',
  get BACKEND_URL() { return `http://${this.BACKEND_HOST}:${this.BACKEND_PORT}`; },
  DB_PATH: process.env.E2E_DB_PATH || `/tmp/vxin-e2e-${process.env.E2E_RUN_ID || 'dev'}.db`,
  INVITE_CODE: process.env.E2E_INVITE_CODE || '123456',
  // 必须 ≥32 字符，否则 backend config 校验 process.exit(1)，后端起不来、E2E 全挂
  JWT_SECRET: process.env.E2E_JWT_SECRET || 'e2e-test-secret-0123456789abcdefghij',

  // 前端入口
  // web: vite dev/preview 或线上;electron: 由 _electron 启动,baseURL 无意义
  WEB_URL: process.env.E2E_WEB_URL || 'http://127.0.0.1:4178',

  // 测试账号密码(造号用,满足后端 ≥8位含字母数字)
  TEST_PASSWORD: 'e2epass1234',
};
