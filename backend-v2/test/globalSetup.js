'use strict';
/**
 * Jest globalSetup：整轮测试前跑一次。
 *   1. 删除上轮遗留的临时库（含 WAL/SHM），保证干净起点
 *   2. 连接（自动建表）并播种「历史种子用户」13800001111 / 123456，
 *      供 moments/collections 等老用例（凭该账号 cookie 登录）真正跑起来，
 *      而非因登录失败而静默跳过。
 */
const fs = require('fs');
const { TEST_DB } = require('./testEnv');

module.exports = async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB + suffix); } catch { /* 不存在即忽略 */ }
  }

  const bcrypt = require('bcryptjs');
  const { v4: uuid } = require('uuid');
  const { db, generateVxinId } = require('../src/db/connection'); // 连接即建表

  const hash = bcrypt.hashSync('123456', 10);
  db.prepare(
    'INSERT OR IGNORE INTO users (id,username,phone,password,wechat_id) VALUES (?,?,?,?,?)'
  ).run(uuid(), '种子用户', '13800001111', hash, generateVxinId());
};
