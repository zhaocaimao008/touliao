'use strict';
/**
 * 生产监控主动告警（见 AUDIT.md 十七节"基础监控"🟡）：
 *   - alerts.js：Telegram 推送，未配置 ALERT_BOT_TOKEN/ALERT_CHAT_ID 时静默跳过
 *   - prodMetrics.pushAlert：越限记录进环形缓冲 + 触发推送，同一类型 15 分钟内只推一次
 *   - prodMetrics.snapshot().disk：新增的磁盘剩余空间快照
 * 每个 test 都 jest.resetModules() 重新 require，避免模块级 lastPushedAt/alerts 状态串测。
 */

describe('alerts.sendTelegramAlert', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; delete process.env.ALERT_BOT_TOKEN; delete process.env.ALERT_CHAT_ID; });

  test('未配置 token/chatId 时不发起任何网络请求', async () => {
    delete process.env.ALERT_BOT_TOKEN;
    delete process.env.ALERT_CHAT_ID;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.resetModules();
    const { sendTelegramAlert } = require('../src/utils/alerts');
    await sendTelegramAlert('test message');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('配置了 token/chatId 时正确调用 Telegram API', async () => {
    process.env.ALERT_BOT_TOKEN = 'test-token-123';
    process.env.ALERT_CHAT_ID = 'test-chat-456';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
    jest.resetModules();
    const { sendTelegramAlert } = require('../src/utils/alerts');
    await sendTelegramAlert('磁盘剩余不足');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token-123/sendMessage');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe('test-chat-456');
    expect(body.text).toBe('磁盘剩余不足');
  });

  test('fetch 抛错时不向上抛异常（告警发送失败不应该拖垮调用方）', async () => {
    process.env.ALERT_BOT_TOKEN = 'test-token';
    process.env.ALERT_CHAT_ID = 'test-chat';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    jest.resetModules();
    const { sendTelegramAlert } = require('../src/utils/alerts');
    await expect(sendTelegramAlert('x')).resolves.toBeUndefined();
  });
});

describe('prodMetrics.pushAlert 环形缓冲 + 推送冷却', () => {
  beforeEach(() => { jest.resetModules(); });

  test('越限记录进环形缓冲', () => {
    const pm = require('../src/utils/prodMetrics');
    pm.pushAlert('TEST_TYPE', 999, 500, { unit: 'ms' });
    expect(pm._alerts.length).toBeGreaterThan(0);
    const last = pm._alerts[pm._alerts.length - 1];
    expect(last.type).toBe('TEST_TYPE');
    expect(last.value).toBe(999);
    expect(last.threshold).toBe(500);
  });

  test('同一类型 15 分钟冷却内只推送一次 Telegram', async () => {
    process.env.ALERT_BOT_TOKEN = 'test-token';
    process.env.ALERT_CHAT_ID = 'test-chat';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
    jest.resetModules();
    const pm = require('../src/utils/prodMetrics');

    pm.pushAlert('MEMORY', 85, 80, { unit: '%' });
    pm.pushAlert('MEMORY', 90, 80, { unit: '%' }); // 冷却窗口内的第二次越限，不应该再推
    await new Promise(r => setImmediate(r)); // 让 pushAlert 内部的异步 sendTelegramAlert 有机会执行

    expect(fetchMock).toHaveBeenCalledTimes(1);

    delete process.env.ALERT_BOT_TOKEN;
    delete process.env.ALERT_CHAT_ID;
  });

  test('不同类型各自独立冷却，互不影响', async () => {
    process.env.ALERT_BOT_TOKEN = 'test-token';
    process.env.ALERT_CHAT_ID = 'test-chat';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
    jest.resetModules();
    const pm = require('../src/utils/prodMetrics');

    pm.pushAlert('MEMORY', 85, 80, { unit: '%' });
    pm.pushAlert('DISK_FREE', 100, 500, { unit: 'MB' });
    await new Promise(r => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledTimes(2);

    delete process.env.ALERT_BOT_TOKEN;
    delete process.env.ALERT_CHAT_ID;
  });
});

describe('prodMetrics.snapshot() 磁盘快照', () => {
  beforeEach(() => { jest.resetModules(); });

  test('disk 字段返回合理的真实磁盘数据', () => {
    const pm = require('../src/utils/prodMetrics');
    const snap = pm.snapshot(0, 0);
    expect(snap.disk).not.toBeNull();
    expect(snap.disk.totalMB).toBeGreaterThan(0);
    expect(snap.disk.freeMB).toBeGreaterThanOrEqual(0);
    expect(snap.disk.freeMB).toBeLessThanOrEqual(snap.disk.totalMB);
    expect(typeof snap.disk.usedPercent).toBe('number');
  });

  test('thresholds 里带 diskFreeBytes，且与 utils/upload.js 的 500MB 阈值同口径', () => {
    const pm = require('../src/utils/prodMetrics');
    expect(pm.TH.diskFreeBytes).toBe(500 * 1024 * 1024);
  });
});
