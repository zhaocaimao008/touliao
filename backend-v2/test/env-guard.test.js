'use strict';
/**
 * 环境变量注入保护回归测试
 *  1. CALL_TIMEOUT_MS / CALL_COOLDOWN_MS:非法/异常值一律回退默认,
 *     防生产 .env 手滑或部署环境继承(0/负数/NaN 会让通话全部创建即超时、
 *     或限流静默失效)。
 *  2. FORCE_SYNC_WRITES:仅 NODE_ENV=test 生效——非 test 环境设置必须被
 *     忽略并告警(同步写会阻塞事件循环,拖垮生产吞吐)。
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { resolveTimeoutMs, resolveCooldownMs } = require('../src/realtime/handlers/call');

describe('CALL_TIMEOUT_MS / CALL_COOLDOWN_MS env 保护', () => {
  test('未设置 → 生产默认(120s / 5s),行为不变', () => {
    expect(resolveTimeoutMs(undefined, 120_000, 1_000)).toBe(120_000);
    expect(resolveCooldownMs(undefined, 5_000)).toBe(5_000);
    expect(resolveTimeoutMs('', 120_000, 1_000)).toBe(120_000);
  });

  test('测试注入的合法短值正常生效(3000 / 0)', () => {
    expect(resolveTimeoutMs('3000', 120_000, 1_000)).toBe(3000);
    expect(resolveCooldownMs('0', 5_000)).toBe(0);
  });

  test('异常值一律回退默认:负数 / NaN / 超时过小(0、500ms) / 超大值', () => {
    expect(resolveTimeoutMs('-5', 120_000, 1_000)).toBe(120_000);
    expect(resolveTimeoutMs('abc', 120_000, 1_000)).toBe(120_000);
    expect(resolveTimeoutMs('0', 120_000, 1_000)).toBe(120_000);
    expect(resolveTimeoutMs('500', 120_000, 1_000)).toBe(120_000);
    // 超大值:setTimeout 超 2^31-1ms 会溢出成 1ms,必须回退
    expect(resolveTimeoutMs('1e15', 120_000, 1_000)).toBe(120_000);
    expect(resolveTimeoutMs('99999999999', 120_000, 1_000)).toBe(120_000);
    expect(resolveCooldownMs('abc', 5_000)).toBe(5_000);
    expect(resolveCooldownMs('-5', 5_000)).toBe(5_000);
    expect(resolveCooldownMs('1e999', 5_000)).toBe(5_000); // Infinity
    expect(resolveCooldownMs('99999999999', 5_000)).toBe(5_000); // 冷却锁死多年
  });
});

describe('FORCE_SYNC_WRITES 门禁(仅 NODE_ENV=test 生效)', () => {
  const root = path.join(__dirname, '..');
  const script = "const w=require('./src/db/writer'); console.log('loaded'); process.exit(0);";

  test('NODE_ENV=production + FORCE_SYNC_WRITES=1 → 忽略并告警', () => {
    const r = spawnSync(process.execPath, ['-e', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      // 2026-09-02 修复：config/index.js 的 production 硬校验（:160-176：JWT_SECRET≥32 字符、
      // ADMIN_JWT_SECRET≥32、ADMIN_USERNAME/ADMIN_PASSWORD≥12 必配）会让本用例 spawn 的
      // production 子进程 exit 1。此前本用例靠本地 backend-v2/.env（gitignored，dotenv 自动加载）
      // 隐式提供全部变量才通过——CI checkout 无 .env 必挂（9/1 起 CI 连续红的根因）。
      // 显式注入使测试对本地 .env 零依赖，CI/本地行为一致。
      env: {
        ...process.env,
        NODE_ENV: 'production', FORCE_SYNC_WRITES: '1',
        JWT_SECRET: 'env-guard-test-jwt-secret-0123456789abcdef',
        ADMIN_USERNAME: 'env-guard-admin',
        ADMIN_PASSWORD: 'env-guard-admin-password-123456',
        DB_PATH: '/tmp/fs-guard-prod.sqlite',
      },
    });
    expect(r.status).toBe(0);
    expect(r.stderr + r.stdout).toContain('已忽略');   // 必须告警
  });

  test('NODE_ENV=test + FORCE_SYNC_WRITES=1 → 正常进入同步模式(无告警)', () => {
    const r = spawnSync(process.execPath, ['-e', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, NODE_ENV: 'test', FORCE_SYNC_WRITES: '1', DB_PATH: '/tmp/fs-guard-test.sqlite' },
    });
    expect(r.status).toBe(0);
    expect(r.stderr + r.stdout).not.toContain('已忽略');
    expect(r.stderr + r.stdout).toContain('loaded');
  });
});
