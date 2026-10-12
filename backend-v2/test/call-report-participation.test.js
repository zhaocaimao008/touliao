'use strict';
// 2026-10-12：POST /api/calls/:callId/report 核验上报者参与过该通话。
const { v4: uuidv4 } = require('uuid');
const { app, request, makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
const svc = require('../src/modules/telemetry/telemetry.service');
const createRegistry = require('../src/realtime/callSessionRegistry');
const registerGroupCallHandler = require('../src/realtime/handlers/groupCall');

afterAll(async () => { await require('../src/db/writer').shutdown(); });

const BODY = {
  role: 'caller', callType: 'audio', group: false, connected: true, setupMs: 1200, durationSec: 30,
  endReason: 'hangup', iceRestarts: 0, localCandidateType: 'host', remoteCandidateType: 'srflx',
  protocol: 'udp', relayProtocol: null, rttMsAvg: 40, packetLossPct: 0.5, platform: 'web', appVersion: '1.0.0',
};
const report = (u, callId, body = BODY) => request(app).post(`/api/calls/${callId}/report`)
  .set('Authorization', `Bearer ${u.token}`).send(body);
const rowOf = (callId, userId) => db.prepare('SELECT * FROM call_reports WHERE call_id=? AND user_id=?').get(callId, userId);

async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timeout');
    await new Promise(r => setTimeout(r, 20));
  }
}

function groupConversation(...users) {
  const id = uuidv4();
  db.prepare("INSERT INTO conversations (id,type,name) VALUES (?, 'group', 'g')").run(id);
  for (const u of users) db.prepare("INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)").run(id, u.userId);
  return id;
}

// 最小 socket.io 替身（与 group-call-occupancy.test.js 同构），驱动真实 groupCall 处理器
function ioHarness() {
  const emitted = [];
  return { emitted, to: room => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
}
function fakeSocket(userId, io) {
  const handlers = {};
  const emitted = [];
  return {
    id: `${userId}-sock`, user: { id: userId }, handlers, emitted,
    on(e, h) { handlers[e] = h; return this; }, once(e, h) { return this.on(e, h); },
    emit(event, payload) { emitted.push({ event, payload }); return this; },
    to: room => io.to(room),
    last: e => emitted.filter(x => x.event === e).at(-1),
  };
}

describe('1v1：call_logs 为准', () => {
  let a, b, outsider;
  beforeAll(async () => { a = await makeUser(); b = await makeUser(); outsider = await makeUser(); });

  test('主被叫可上报，角色/是否群通话以服务端记录为准；非参与者 403 且不落库', async () => {
    const callId = `p2p-${Date.now()}`;
    db.prepare("INSERT INTO call_logs (id,caller_id,callee_id,type,status) VALUES (?,?,?,'audio','completed')").run(callId, a.userId, b.userId);

    const ra = await report(a, callId);
    expect(ra.status).toBe(200);
    expect(ra.body).toEqual({ success: true, verified: true });
    // 被叫谎称 caller + group：按 call_logs 纠正
    const rb = await report(b, callId, { ...BODY, role: 'caller', group: true });
    expect(rb.status).toBe(200);
    expect(rowOf(callId, a.userId)).toMatchObject({ role: 'caller', is_group: 0, verified: 1 });
    expect(rowOf(callId, b.userId)).toMatchObject({ role: 'callee', is_group: 0, verified: 1 });

    const ro = await report(outsider, callId);
    expect(ro.status).toBe(403);
    expect(ro.body.error_code).toBe('NOT_CALL_PARTICIPANT');
    expect(rowOf(callId, outsider.userId)).toBeUndefined();
  });

  test('查无记录的 callId：照存但 verified=0，统计默认排除', async () => {
    const callId = `ghost-${Date.now()}`;
    const res = await report(outsider, callId, { ...BODY, platform: 'ios' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, verified: false });
    expect(rowOf(callId, outsider.userId)).toMatchObject({ verified: 0, role: 'caller' });

    const strict = svc.callStats(7);
    expect(strict.byPlatform.ios).toBeUndefined();
    expect(strict.unverifiedReports).toBeGreaterThanOrEqual(1);
    const loose = svc.callStats(7, { includeUnverified: true });
    expect(loose.byPlatform.ios.reports).toBeGreaterThanOrEqual(1);
    expect(loose.overall.reports).toBe(strict.overall.reports + loose.unverifiedReports);
  });
});

describe('群通话：group_call_logs + 进程内参与者历史 + 群成员关系', () => {
  test('发起人/加入过的成员 verified；未加入的群成员 unverified；非群成员 403', async () => {
    const starter = await makeUser();
    const joiner = await makeUser();
    const idle = await makeUser();
    const stranger = await makeUser();
    const convId = groupConversation(starter, joiner, idle);

    const io = ioHarness();
    const registry = createRegistry();
    const s1 = fakeSocket(starter.userId, io);
    const s2 = fakeSocket(joiner.userId, io);
    registerGroupCallHandler(io, s1, registry);
    registerGroupCallHandler(io, s2, registry);
    s1.handlers['group_call:start']({ conversationId: convId, type: 'audio' });
    const callId = s1.last('group_call:started')?.payload?.callId;
    expect(callId).toBeTruthy();
    s2.handlers['group_call:join']({ callId });
    expect(s2.last('group_call:peers')).toBeDefined();
    // 两人都离开 → 通话结束（groupCalls 已删除，只剩参与者历史）
    s2.handlers['group_call:leave']({ callId });
    s1.handlers['group_call:leave']({ callId });
    expect(registerGroupCallHandler._state.groupCalls.has(callId)).toBe(false);
    await waitFor(() => !!db.prepare('SELECT 1 FROM group_call_logs WHERE id=?').get(callId));

    const groupBody = { ...BODY, group: false, role: 'callee' };
    expect((await report(starter, callId, groupBody)).body).toEqual({ success: true, verified: true });
    expect(rowOf(callId, starter.userId)).toMatchObject({ role: 'caller', is_group: 1, verified: 1 });
    expect((await report(joiner, callId, groupBody)).body).toEqual({ success: true, verified: true });
    expect(rowOf(callId, joiner.userId)).toMatchObject({ role: 'callee', is_group: 1, verified: 1 });
    // 群成员但没加入过（或服务重启丢了内存历史）→ 不拒绝，标 unverified
    expect((await report(idle, callId, groupBody)).body).toEqual({ success: true, verified: false });
    expect(rowOf(callId, idle.userId)).toMatchObject({ is_group: 1, verified: 0 });
    // 不是群成员 → 不可能加入过 → 403
    expect((await report(stranger, callId, groupBody)).status).toBe(403);
    expect(rowOf(callId, stranger.userId)).toBeUndefined();
    registry.reset();
  });

  test('参与者历史：结束后保留期内有效、过期失效、总量封顶', () => {
    const { wasGroupCallParticipant, _participantHistory: H } = registerGroupCallHandler;
    const now = Date.now();
    H.participantHistory.set('hist-1', { users: new Set(['u1']), endedAt: now - 1000 });
    H.participantHistory.set('hist-2', { users: new Set(['u2']), endedAt: now - H.PARTICIPANT_HISTORY_TTL_MS - 1 });
    expect(wasGroupCallParticipant('hist-1', 'u1', now)).toBe(true);
    expect(wasGroupCallParticipant('hist-1', 'u9', now)).toBe(false);
    expect(wasGroupCallParticipant('hist-2', 'u2', now)).toBe(false);
    H.pruneParticipantHistory(now);
    expect(H.participantHistory.has('hist-2')).toBe(false);
    for (let i = 0; i < H.PARTICIPANT_HISTORY_MAX + 10; i++) H.participantHistory.set(`cap-${i}`, { users: new Set(), endedAt: null });
    H.pruneParticipantHistory(now);
    expect(H.participantHistory.size).toBe(H.PARTICIPANT_HISTORY_MAX);
    H.participantHistory.clear();
  });
});

