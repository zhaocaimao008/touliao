'use strict';
// DB_PATH 等隔离测试库环境变量已由 jest.config 的 setupFiles(test/testEnv.js) 设置，
// 不需要在这里再手动 require 一次。
const { v4: uuid } = require('uuid');
const { db } = require('../src/db/connection');
const { reconcileInterruptedCalls } = require('../src/realtime/callReconciler');

function seedCallLog({ id, status, endedAt = null }) {
  db.prepare(
    'INSERT INTO call_logs (id,caller_id,callee_id,type,status,started_at,ended_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, 'alice-reconcile', 'bob-reconcile', 'audio', status, 1000, endedAt);
}

function seedGroupCallLog({ id, status, endedAt = null }) {
  db.prepare(
    'INSERT INTO group_call_logs (id,conversation_id,started_by,type,status,started_at,ended_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, 'conv-reconcile', 'alice-reconcile', 'audio', status, 1000, endedAt);
}

function callLog(id) {
  return db.prepare('SELECT * FROM call_logs WHERE id=?').get(id);
}

function groupLog(id) {
  return db.prepare('SELECT * FROM group_call_logs WHERE id=?').get(id);
}

describe('callReconciler', () => {
  test('startup closes one-to-one and group logs left active by restart', async () => {
    const c1 = uuid();
    const g1 = uuid();
    seedCallLog({ id: c1, status: 'ongoing' });
    seedGroupCallLog({ id: g1, status: 'ongoing' });

    await reconcileInterruptedCalls(12345);

    expect(callLog(c1)).toMatchObject({ status: 'interrupted', ended_at: 12345 });
    expect(groupLog(g1)).toMatchObject({ status: 'ended', ended_at: 12345 });
  });

  test('does not touch calls that already have a terminal status', async () => {
    const completed = uuid();
    const missed = uuid();
    const rejected = uuid();
    const canceled = uuid();
    const groupEnded = uuid();
    seedCallLog({ id: completed, status: 'completed', endedAt: 999 });
    seedCallLog({ id: missed, status: 'missed' }); // missed 从来没有 ended_at，也不该被碰
    seedCallLog({ id: rejected, status: 'rejected', endedAt: 999 });
    seedCallLog({ id: canceled, status: 'canceled', endedAt: 999 });
    seedGroupCallLog({ id: groupEnded, status: 'ended', endedAt: 999 });

    await reconcileInterruptedCalls(99999);

    expect(callLog(completed)).toMatchObject({ status: 'completed', ended_at: 999 });
    expect(callLog(missed)).toMatchObject({ status: 'missed', ended_at: null });
    expect(callLog(rejected)).toMatchObject({ status: 'rejected', ended_at: 999 });
    expect(callLog(canceled)).toMatchObject({ status: 'canceled', ended_at: 999 });
    expect(groupLog(groupEnded)).toMatchObject({ status: 'ended', ended_at: 999 });
  });

  test('does not touch an ongoing call that somehow already has ended_at set', async () => {
    // 正常业务代码不会出现 status='ongoing' 但 ended_at 非空的组合，这里只是确认
    // WHERE 子句的 ended_at IS NULL 条件真的在生效，不是巧合通过。
    const weird = uuid();
    seedCallLog({ id: weird, status: 'ongoing', endedAt: 555 });

    await reconcileInterruptedCalls(12345);

    expect(callLog(weird)).toMatchObject({ status: 'ongoing', ended_at: 555 });
  });
});
