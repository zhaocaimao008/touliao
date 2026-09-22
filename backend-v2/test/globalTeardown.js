'use strict';
/** Jest globalTeardown：整轮结束后删除临时测试库，不留残留。 */
const fs = require('fs');
const { TEST_DB, TEST_ROOT } = require('./testEnv');

module.exports = async () => {
  // Only remove directories allocated by this test harness.
  if (require('path').basename(TEST_ROOT).startsWith('touliao-test-')) {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    return;
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB + suffix); } catch { /* 不存在即忽略 */ }
  }
};
