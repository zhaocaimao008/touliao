'use strict';
/**
 * 个推瞬时失败重试（2026-09-04）。
 *
 * 背景：push/single/cid 此前一超时就失败，调用方 utils/push.js 只
 * `.catch(e => console.warn('[push] 个推异常: ...'))` 静默丢弃——用户那条通知就没了。
 * 生产日志实测 2026-09-03 14:05~14:26 有 8 次 `个推异常: getui timeout`，
 * 即 8 条安卓通知无声丢失。
 *
 * 重试安全性的前提：个推以 message.request_id 幂等去重。所以重试必须复用**同一个**
 * request_id——否则「首次其实已送达、只是响应超时」会变成给用户重复推两条。
 * 第 4 个用例就是在钉死这条不变量。
 */
require('./testEnv');
const { sendPushWithRetry, PUSH_MAX_ATTEMPTS } = require('../src/utils/getuiPush');

const MSG = { request_id: 'fixed-req-id-123', audience: { cid: ['cid-1'] } };
const ok = { status: 200, json: { code: 0 } };

/** 按给定序列依次响应；'timeout' 抛错，其余原样返回。记录每次收到的 message。 */
function fakeSender(sequence) {
  const seen = [];
  let i = 0;
  const send = async (_method, _path, _headers, message) => {
    seen.push(message);
    const step = sequence[Math.min(i, sequence.length - 1)];
    i += 1;
    if (step === 'timeout') throw new Error('getui timeout');
    if (step === 'econnreset') throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    return step;
  };
  return { send, seen, count: () => i };
}

describe('sendPushWithRetry', () => {
  test('一次成功：不重试', async () => {
    const f = fakeSender([ok]);
    const res = await sendPushWithRetry('/push/single/cid', 'tk', MSG, { send: f.send, delayMs: 0 });
    expect(res).toEqual(ok);
    expect(f.count()).toBe(1);
  });

  test('首次超时 → 重试一次并成功（通知不再无声丢失）', async () => {
    const f = fakeSender(['timeout', ok]);
    const res = await sendPushWithRetry('/push/single/cid', 'tk', MSG, { send: f.send, delayMs: 0 });
    expect(res).toEqual(ok);
    expect(f.count()).toBe(2);
  });

  test('连接被重置也算瞬时失败 → 重试', async () => {
    const f = fakeSender(['econnreset', ok]);
    const res = await sendPushWithRetry('/push/single/cid', 'tk', MSG, { send: f.send, delayMs: 0 });
    expect(res).toEqual(ok);
    expect(f.count()).toBe(2);
  });

  test('重试必须复用同一 request_id（个推据此幂等去重，否则会重复推送）', async () => {
    const f = fakeSender(['timeout', ok]);
    await sendPushWithRetry('/push/single/cid', 'tk', MSG, { send: f.send, delayMs: 0 });
    expect(f.seen).toHaveLength(2);
    expect(f.seen[0].request_id).toBe('fixed-req-id-123');
    expect(f.seen[1].request_id).toBe('fixed-req-id-123');
    expect(f.seen[0]).toBe(f.seen[1]);   // 同一对象，不可能被重新生成
  });

  test('5xx 视为瞬时失败 → 重试', async () => {
    const f = fakeSender([{ status: 503, json: {} }, ok]);
    const res = await sendPushWithRetry('/push/single/cid', 'tk', MSG, { send: f.send, delayMs: 0 });
    expect(res).toEqual(ok);
    expect(f.count()).toBe(2);
  });

  test('4xx 是确定性拒绝 → 不重试，原样返回给调用方处理', async () => {
    const rejected = { status: 400, json: { code: 10001, msg: 'cid invalid' } };
    const f = fakeSender([rejected]);
    const res = await sendPushWithRetry('/push/single/cid', 'tk', MSG, { send: f.send, delayMs: 0 });
    expect(res).toEqual(rejected);
    expect(f.count()).toBe(1);
  });

  test('HTTP 200 但业务 code!=0 → 不重试（重试也不会变），交调用方判', async () => {
    const bizFail = { status: 200, json: { code: 10002, msg: 'token expired' } };
    const f = fakeSender([bizFail]);
    const res = await sendPushWithRetry('/push/single/cid', 'tk', MSG, { send: f.send, delayMs: 0 });
    expect(res).toEqual(bizFail);
    expect(f.count()).toBe(1);
  });

  test('持续超时 → 用尽次数后抛出，由调用方 catch 记日志', async () => {
    const f = fakeSender(['timeout']);
    await expect(
      sendPushWithRetry('/push/single/cid', 'tk', MSG, { send: f.send, delayMs: 0 })
    ).rejects.toThrow('getui timeout');
    expect(f.count()).toBe(PUSH_MAX_ATTEMPTS);
  });

  test('重试次数有上限，不会无限重试拖垮推送链路', () => {
    expect(PUSH_MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(PUSH_MAX_ATTEMPTS).toBeLessThanOrEqual(3);
  });
});
