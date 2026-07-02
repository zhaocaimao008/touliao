'use strict';
/**
 * 测试环境初始化（jest setupFiles + globalSetup 共用）。
 *
 * 关键：本文件在 require('../src/app') 之前执行，抢先写好 process.env，
 * 使 config 取到「隔离测试库 + 测试开关」，绝不触碰生产 wechat.db：
 *   - DB_PATH            → 独立临时库（连接时自动建表，见 db/connection.js）
 *   - DISABLE_CSRF=1     → 关双提交校验（supertest 不易回传 csrf cookie/header）
 *   - DISABLE_RATE_LIMIT=1→ 关所有限流（批量造号/发消息不被 429 挡）
 *   - INVITE_CODE        → 固定测试邀请码，使注册可用（fresh 库无 admin_settings）
 *   - JWT_SECRET 等      → 固定测试密钥（≥32 字符，满足生产级校验）
 * dotenv 默认不覆盖已存在的 env，故这些值优先于 .env，隔离得以保证。
 */
const path = require('path');

const TEST_DB = path.join(__dirname, '.tmp-test-db.sqlite');

process.env.NODE_ENV          = 'test';
process.env.DB_PATH           = TEST_DB;
process.env.DISABLE_CSRF      = '1';
process.env.DISABLE_RATE_LIMIT = '1';
process.env.INVITE_CODE       = process.env.TEST_INVITE_CODE || '123456';
process.env.JWT_SECRET        = process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_chars_long__x';
process.env.ADMIN_JWT_SECRET  = process.env.ADMIN_JWT_SECRET || 'test_admin_jwt_secret_at_least_32_chars_x';

module.exports = { TEST_DB, INVITE_CODE: process.env.INVITE_CODE };
