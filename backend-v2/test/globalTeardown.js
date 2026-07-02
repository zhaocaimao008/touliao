'use strict';
/** Jest globalTeardown：整轮结束后删除临时测试库，不留残留。 */
const fs = require('fs');
const { TEST_DB } = require('./testEnv');

module.exports = async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB + suffix); } catch { /* 不存在即忽略 */ }
  }
};
