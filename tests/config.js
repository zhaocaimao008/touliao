// 本机同时跑着另一个真实生产项目(vxin)，且历史上和投聊混用过 3002 端口。
// 这批压测/机器人脚本会造大量账号、发大量消息，一旦端口配错会直接冲击别的项目
// 的生产数据。这里在被 require 时就异步校验 BASE_URL 确实是投聊后端，不是则退出。
// 注意：这是尽力而为的安全网，不保证在校验完成前的极短窗口内 0 请求逃逸，
// 但能挡住"整轮压测跑在错误目标上而无人发现"这种规模化误伤。
require('../ops/_envGuard').assertTouliaoBackend(process.env.BASE_URL || 'http://localhost:3002');

module.exports = {
  BASE_URL:   process.env.BASE_URL || 'http://localhost:3002',
  WS_URL:     process.env.BASE_URL || 'http://localhost:3002',

  // 账号
  BOT_COUNT:        500,
  BOT_PREFIX:       'testbot',
  BOT_PASS:         'Test@123456',
  BOT_PHONE_BASE:   '17000000',   // 170-00000001 ~ 170-00000500

  // 压测规模
  STRESS_BOTS:          100,      // 并发机器人数
  STRESS_WORKERS:        50,      // 实际发消息 worker 数
  GROUP_COUNT:          100,      // 群数量
  GROUP_MEMBER_MAX:     100,      // 单群最大成员（受限于账号数）
  MSG_COUNT:         100000,      // 压测消息总数
  STRESS_DURATION_S:    300,      // 压测最长持续秒数（5分钟）

  // 随机机器人
  BOT_ACTIVE_COUNT:     100,      // 随机机器人并发数
  BOT_ACTIVE_DURATION: 120_000,   // 每轮机器人活动时长 ms

  // 内存监控
  MEM_INTERVAL_MS:   600_000,     // 每 10 分钟采样一次

  // 24h 运行
  LOOP_INTERVAL_MS:  300_000,     // 轮间隔 5 分钟
  LOOP_DURATION_H:        24,     // 总运行时长（小时）

  // 路径
  REPORTS_DIR:      __dirname + '/test-reports',
  SCREENSHOTS_DIR:  __dirname + '/test-reports/screenshots',
};
