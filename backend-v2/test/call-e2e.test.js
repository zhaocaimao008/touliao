'use strict';
/**
 * 通话模块 E2E(真 socket 全链路)。
 *
 * 信令契约(与 handlers/call.js 对齐):
 *   call:request(ack→callId) / call:incoming{from,type,callId,caller}
 *   call:response{from,accepted,busy,reason,callId}(主叫收)
 *   call:end{from,reason,callId}(reason: timeout/answered_elsewhere/rejected_elsewhere 等)
 *   call:resume 无 ack(行为断言:重连后通话仍活跃)
 *
 * 环境:Jest + 测试库(testEnv)。CALL_TIMEOUT_MS / CALL_RECONNECT_GRACE_MS
 * 经环境变量注入短值(生产默认 120s / 15s,行为不变)。
 */
process.env.CALL_TIMEOUT_MS = process.env.CALL_TIMEOUT_MS || '3000';      // 超时场景 3s
process.env.CALL_RECONNECT_GRACE_MS = process.env.CALL_RECONNECT_GRACE_MS || '3000'; // 宽限 3s(给重连留余量)
process.env.CALL_COOLDOWN_MS = process.env.CALL_COOLDOWN_MS || '0';       // 测试关冷却(连续场景)
process.env.FORCE_SYNC_WRITES = '1';   // writer 同步落库(jest 下 worker flush 延迟不稳定)

const http = require('http');
const { io: Client } = require('socket.io-client');
const { Server } = require('socket.io');
const { app, makeUser, befriend, privateConversation } = require('./helpers');
const setupRealtime = require('../src/realtime');
const { db } = require('../src/db/connection');

let server, port, sockets = [];

beforeAll(async () => {
  server = http.createServer(app);
  const io = new Server(server, { transports: ['websocket'], maxHttpBufferSize: 512 * 1024 });
  app.set('io', io);
  setupRealtime(io, app);
  await new Promise(r => server.listen(0, r));
  port = server.address().port;
});

afterAll(async () => {
  for (const s of sockets) { try { s.disconnect(); } catch {} }
  await new Promise(r => server.close(r));
});

/** 带 cookie 认证连接(与 e2e.js 同款)。 */
function connect(token) {
  const s = Client(`http://127.0.0.1:${port}`, {
    transports: ['websocket'], reconnection: false,
    extraHeaders: { Cookie: `vxin_token=${token}` },
  });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', e => reject(new Error('socket 连接失败: ' + e.message)));
    setTimeout(() => reject(new Error('socket 连接超时')), 5000);
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));
function once(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`等待 ${event} 超时`)), timeoutMs);
    socket.once(event, (d) => { clearTimeout(t); resolve(d); });
  });
}

/** 发起呼叫,返回 callId。 */
function callRequest(sa, a, b, type = 'audio') {
  return new Promise((resolve, reject) => {
    sa.emit('call:request', {
      to: b.userId, type,
      caller: { id: a.userId, name: a.username, avatar: '' },
    }, (ack) => ack?.callId ? resolve(ack.callId) : reject(new Error('ack 无 callId')));
  });
}

function lastCallLog(aId, bId) {
  return db.prepare(
    "SELECT * FROM call_logs WHERE (caller_id=? AND callee_id=?) OR (caller_id=? AND callee_id=?) ORDER BY started_at DESC, rowid DESC LIMIT 1"
  ).get(aId, bId, bId, aId);
}
function lastCallMessage(convId) {
  return db.prepare("SELECT * FROM messages WHERE type='call' AND conversation_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(convId);
}
/** writer 走 worker 异步落库——轮询等待记录出现(竞态防护)。 */
async function waitFor(fn, timeoutMs = 4000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return v;
    await wait(100);
  }
}

describe('通话 E2E 信令全链路(真 socket)', () => {
  let a, b, convId;

  beforeAll(async () => {
    a = await makeUser({ username: 'e2e_call_a' });
    b = await makeUser({ username: 'e2e_call_b' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
  });

  afterEach(async () => {
    for (const s of sockets) { try { s.disconnect(); } catch {} }
    sockets = [];
    // 等 writer worker 队列 flush 后双清(worker 迟到写入会残留到下一测试)
    await wait(500);
    db.prepare("DELETE FROM messages WHERE type='call'").run();
    db.prepare("DELETE FROM call_logs").run();
    await wait(200);
    db.prepare("DELETE FROM messages WHERE type='call'").run();
    db.prepare("DELETE FROM call_logs").run();
  });

  test('全链路:发起→响铃→接听→挂断→call_logs completed→messages 通话气泡', async () => {
    const sa = await connect(a.token);
    const sb = await connect(b.token);

    const incomingP = once(sb, 'call:incoming');
    const callId = await callRequest(sa, a, b);
    const incoming = await incomingP;
    expect(incoming.callId).toBe(callId);
    expect(incoming.type).toBe('audio');            // 契约字段:type(非 callType)
    expect(incoming.from).toBe(a.userId);           // 契约字段:from(非 callerId)

    // 接听:B 应答 → 主叫 A 收 call:response {accepted:true}
    const respA = once(sa, 'call:response');
    sb.emit('call:response', { to: a.userId, callId, accepted: true });
    const resp = await respA;
    expect(resp.accepted).toBe(true);
    expect(resp.callId).toBe(callId);

    // B 挂断 → 对方(A)收到 call:end;挂断者自己无回声(契约:socket.to 不含操作设备)
    const endA = once(sa, 'call:end');
    sb.emit('call:end', { to: a.userId, callId });
    await endA;

    // call_logs 落库 completed
    const log = await waitFor(() => lastCallLog(a.userId, b.userId));
    expect(log).toBeTruthy();
    expect(log.status).toBe('completed');
    expect(log.caller_id).toBe(a.userId);
    expect(log.callee_id).toBe(b.userId);

    // messages 写入通话气泡
    const m = await waitFor(() => lastCallMessage(convId));
    expect(m).toBeTruthy();
    expect(m.sender_id).toBe(a.userId);
    expect(m.content).toMatch(/语音通话/);
    const meta = JSON.parse(m.file_url);
    expect(meta.callId).toBe(callId);
    expect(meta.status).toBe('completed');
  });

  test('拒绝:主叫收 call:response rejected,call_logs=rejected,messages=对方已拒绝', async () => {
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    const callId = await callRequest(sa, a, b);
    const respA = once(sa, 'call:response');
    sb.emit('call:response', { to: a.userId, callId, accepted: false });
    const resp = await respA;
    expect(resp.accepted).toBe(false);

    const log = await waitFor(() => lastCallLog(a.userId, b.userId));
    expect(log.status).toBe('rejected');
    const m = await waitFor(() => lastCallMessage(convId));
    expect(m.content).toBe('对方已拒绝');
    expect(JSON.parse(m.file_url).status).toBe('rejected');
  });

  test('超时:120s 未接(注入 3s)→ call_logs=missed,messages=对方无应答', async () => {
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    const callId = await callRequest(sa, a, b);
    // 被叫收 call:end(timeout);主叫侧由客户端本地超时处理(服务端只通知被叫)
    const endB = once(sb, 'call:end', 6000);
    const d = await endB;
    expect(d.reason).toBe('timeout');
    expect(d.callId).toBe(callId);
    // 契约:call_logs 落库状态为 canceled(消息文案才是 missed/对方无应答)
    const log = await waitFor(() => db.prepare("SELECT * FROM call_logs WHERE id=?").get(callId));
    expect(log.status).toBe('canceled');
    const m = await waitFor(() => lastCallMessage(convId));
    expect(m.content).toBe('对方无应答');
    expect(JSON.parse(m.file_url).status).toBe('missed');
  });

  test('多端:一端接听,另一端收到 call:end(answered_elsewhere)收起', async () => {
    const sa = await connect(a.token);
    const sb1 = await connect(b.token);   // B 设备1
    const sb2 = await connect(b.token);   // B 设备2
    const inc1 = once(sb1, 'call:incoming');
    const inc2 = once(sb2, 'call:incoming');
    const callId = await callRequest(sa, a, b);
    await Promise.all([inc1, inc2]);
    // 设备1 接听 → 设备2 收 call:end(answered_elsewhere)收起;
    // 设备1(操作设备)无回声(契约:socket.to 不含自己)
    const close2 = once(sb2, 'call:end');
    sb1.emit('call:response', { to: a.userId, callId, accepted: true });
    const d = await close2;
    expect(d.reason).toBe('answered_elsewhere');
  });

  test('多端:一端拒绝,另一端收到 call:end(rejected_elsewhere)收起', async () => {
    const sa = await connect(a.token);
    const sb1 = await connect(b.token);
    const sb2 = await connect(b.token);
    const incP1 = once(sb1, 'call:incoming');
    const incP2 = once(sb2, 'call:incoming');
    const callId = await callRequest(sa, a, b);
    await Promise.all([incP1, incP2]);
    const close2 = once(sb2, 'call:end');
    const respP = once(sa, 'call:response');   // 先注册再 emit(事件先到会丢)
    sb1.emit('call:response', { to: a.userId, callId, accepted: false });
    const d = await close2;
    expect(d.reason).toBe('rejected_elsewhere');
    await respP;   // 主叫也收到 rejected 信号
  });

  test('多端:主叫另一设备收 call:outgoing(感知我在别处发起呼叫)', async () => {
    const sa1 = await connect(a.token);
    const sa2 = await connect(a.token);   // A 的另一台设备
    const sb = await connect(b.token);
    const outP = once(sa2, 'call:outgoing');   // 不含发起设备自己
    const callId = await callRequest(sa1, a, b);
    const out = await outP;
    expect(out.callId).toBe(callId);
    expect(out.to).toBe(b.userId);
  });

  test('重拨覆盖:旧 callId 收到 replaced/ended,新 callId 继续', async () => {
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    const callId1 = await callRequest(sa, a, b);
    const replacedP = once(sb, 'call:end', 3000).catch(() => null);   // 被叫旧来电收 replaced
    const callId2 = await callRequest(sa, a, b);   // 未接通前重拨
    expect(callId2).not.toBe(callId1);
    // 旧通话被替换:被叫收 call:end(replaced);旧记录落 canceled
    const r = await replacedP;
    expect(r).not.toBeNull();
    expect(r.reason).toBe('replaced');
    // 旧通话(callId1)落 canceled;新通话(callId2)未接仍 missed
    const log = await waitFor(() => db.prepare("SELECT * FROM call_logs WHERE id=?").get(callId1));
    expect(log.status).toBe('canceled');   // 重拨覆盖旧通话 → canceled
  });

  test('断线重连:宽限内 resume 通话不挂断', async () => {
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    const incP = once(sb, 'call:incoming');
    const respP = once(sa, 'call:response');
    const callId = await callRequest(sa, a, b);
    await incP;
    sb.emit('call:response', { to: a.userId, callId, accepted: true });
    await respP;

    // B 断线(宽限 2s 内)→ 重连 + call:resume → 通话保持;挂断仍走 completed
    sb.disconnect();
    await wait(300);
    const sb2 = await connect(b.token);
    sb2.emit('call:resume', { callId });   // 契约:无 ack,行为断言
    await wait(500);                       // 等 resume 处理(宽限未到期,不应触发挂断)

    const endA = once(sa, 'call:end');
    sb2.emit('call:end', { to: a.userId, callId });
    await endA;
    const log2 = await waitFor(() => lastCallLog(a.userId, b.userId));
    expect(log2.status).toBe('completed');
  });

  test('断线重连:宽限外未重连 → 自动挂断落库', async () => {
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    const incP = once(sb, 'call:incoming');
    const respP2 = once(sa, 'call:response');
    const callId = await callRequest(sa, a, b);
    await incP;
    sb.emit('call:response', { to: a.userId, callId, accepted: true });
    await respP2;

    sb.disconnect();   // 不再重连 → 宽限 2s 后自动收尾
    const endA = once(sa, 'call:end', 8000);
    await endA;
    const log = await waitFor(() => lastCallLog(a.userId, b.userId));
    expect(['completed', 'canceled']).toContain(log.status);
  });
});
