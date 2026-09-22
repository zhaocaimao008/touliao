'use strict';

const workerThreads = require('worker_threads');
const { Worker } = workerThreads;
const { randomUUID } = require('crypto');
const path = require('path');
const { TEST_ROOT } = require('./testEnv');
const shutdownWriterBeforeModuleReset = require('./shutdownWriterBeforeModuleReset');

let constructed;
let workers;
beforeEach(() => {
  workers = [];
  // Observe real Workers; shutdown still uses the production message protocol.
  constructed = jest.spyOn(workerThreads, 'Worker').mockImplementation((...args) => {
    const worker = new Worker(...args);
    const exited = jest.fn();
    worker.on('exit', exited);
    workers.push({ worker, exited });
    return worker;
  });
});

afterEach(async () => {
  // 让晚到的 Worker 'exit' 回调先把崩溃重启定时器排进「即将被丢弃的旧假时钟」,
  // 否则它会排进下一个用例新装的假时钟,污染该用例的 jest.getTimerCount()。
  // setImmediate 未被 fake(doNotFake 列表内),单次宏任务轮转,非 sleep/非重试。
  await new Promise(resolve => setImmediate(resolve));
  await shutdownWriterBeforeModuleReset();
  jest.resetModules();
  jest.dontMock('../src/config');
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function expectNoMessagePorts() {
  expect(process.getActiveResourcesInfo()).not.toContain('MessagePort');
}

function expectExited(index, code = 0) {
  expect(workers[index].exited).toHaveBeenCalledWith(code);
  expect(workers[index].worker.threadId).toBe(-1);
}

test('TEST 1: shutdown waits for the real Worker exit and releases its MessagePort', async () => {
  const writer = require('../src/db/writer');
  expect(constructed).toHaveBeenCalledTimes(1);
  expect(process.getActiveResourcesInfo()).toContain('MessagePort');
  await writer.shutdown();
  expectExited(0);
  expectNoMessagePorts();
});

test('TEST 2: late writes drop safely or reject without creating a Worker or MessagePort', async () => {
  const writer = require('../src/db/writer');
  await writer.shutdown();
  const warn = jest.spyOn(console, 'warn');
  const dropped = writer.backpressure.droppedWrites;
  await expect(writer.writeAsync('SELECT 1')).rejects.toThrow(/stopped|closed/i);
  expect(() => writer.write('SELECT 1')).not.toThrow();
  expect(writer.backpressure.droppedWrites).toBe(dropped + 1);
  expect(warn).toHaveBeenCalledWith(expect.stringMatching(/stopped|closed/i));
  expect(() => writer.write('SELECT 2')).not.toThrow();
  expect(writer.backpressure.droppedWrites).toBe(dropped + 2);
  expect(warn).toHaveBeenCalledTimes(1);
  await expect(writer.writeBatch([])).rejects.toThrow(/stopped|closed/i);
  await expect(writer.writeSequencedEvent({})).rejects.toThrow(/stopped|closed/i);
  expect(constructed).toHaveBeenCalledTimes(1);
  expectExited(0);
  expectNoMessagePorts();
});

test('TEST 3: close before module reset, reload and close both real instances', async () => {
  const first = require('../src/db/writer');
  await shutdownWriterBeforeModuleReset();
  expectExited(0);
  expectNoMessagePorts();
  jest.resetModules();
  const second = require('../src/db/writer');
  expect(second).not.toBe(first);
  expect(constructed).toHaveBeenCalledTimes(2);
  await second.shutdown();
  expectExited(1);
  expectNoMessagePorts();
});

test('TEST 4: assistant service dependencies close before each module reset', async () => {
  require('../src/modules/ai-assistant/assistant.service');
  expect(constructed).toHaveBeenCalledTimes(1);
  await shutdownWriterBeforeModuleReset();
  expectExited(0);
  jest.resetModules();
  require('../src/modules/ai-assistant/assistant.service');
  expect(constructed).toHaveBeenCalledTimes(2);
  await shutdownWriterBeforeModuleReset();
  expectExited(1);
  jest.resetModules();
  expectNoMessagePorts();
});

test('shutdown reuses its promise during and after exit, rejecting writes while stopping', async () => {
  const writer = require('../src/db/writer');
  const shutdown = writer.shutdown();
  expect(writer.shutdown()).toBe(shutdown);
  const warn = jest.spyOn(console, 'warn');
  const dropped = writer.backpressure.droppedWrites;
  const ports = process.getActiveResourcesInfo().filter(type => type === 'MessagePort').length;
  expect(() => writer.write('SELECT 1')).not.toThrow();
  expect(writer.backpressure.droppedWrites).toBe(dropped + 1);
  expect(warn).toHaveBeenCalledWith(expect.stringMatching(/stopped|closed/i));
  expect(() => writer.write('SELECT 2')).not.toThrow();
  expect(writer.backpressure.droppedWrites).toBe(dropped + 2);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(constructed).toHaveBeenCalledTimes(1);
  expect(process.getActiveResourcesInfo().filter(type => type === 'MessagePort')).toHaveLength(ports);
  await expect(writer.writeAsync('SELECT 1')).rejects.toThrow(/stopped|closed/i);
  await expect(writer.writeBatch([])).rejects.toThrow(/stopped|closed/i);
  await expect(writer.writeSequencedEvent({})).rejects.toThrow(/stopped|closed/i);
  await shutdown;
  expect(() => writer.write('SELECT 3')).not.toThrow();
  expect(writer.backpressure.droppedWrites).toBe(dropped + 3);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(writer.shutdown()).toBe(shutdown);
  expectExited(0);
  expectNoMessagePorts();
});

async function withinDeadline(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('lifecycle operation did not settle within 2000ms')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function prepareWriteProbe() {
  const { db } = require('../src/db/connection');
  db.exec('CREATE TABLE IF NOT EXISTS writer_lifecycle_probe (id TEXT PRIMARY KEY, value TEXT)');
  const id = randomUUID();
  return {
    sql: 'INSERT INTO writer_lifecycle_probe (id, value) VALUES (?, ?)',
    params: [id, 'committed'],
    read: () => db.prepare('SELECT value FROM writer_lifecycle_probe WHERE id = ?').get(id),
  };
}

test('an awaited writeAsync before shutdown resolves and remains committed in SQLite', async () => {
  const probe = prepareWriteProbe();
  const writer = require('../src/db/writer');
  await expect(withinDeadline(writer.writeAsync(probe.sql, probe.params))).resolves.toBeUndefined();
  expect(probe.read()).toEqual({ value: 'committed' });
  await withinDeadline(writer.shutdown());
  expect(probe.read()).toEqual({ value: 'committed' });
  expectExited(0);
  expectNoMessagePorts();
});

test('an in-flight write at shutdown commits in SQLite before the real Worker exits', async () => {
  const probe = prepareWriteProbe();
  const writer = require('../src/db/writer');
  const outcome = writer.writeAsync(probe.sql, probe.params).then(() => ({ committed: true }));
  expect(writer.backpressure.queueDepth).toBe(1);
  const [result] = await withinDeadline(Promise.all([outcome, writer.shutdown()]));
  expect(result.committed).toBe(true);
  expect(probe.read()).toEqual({ value: 'committed' });
  expect(writer.backpressure.queueDepth).toBe(0);
  expectExited(0);
  expectNoMessagePorts();
});

test('postMsg buffers safely when a real Worker has exited and worker is null', async () => {
  const writer = require('../src/db/writer');
  const exited = new Promise(resolve => workers[0].worker.once('exit', resolve));
  workers[0].worker.postMessage({ type: 'shutdown' });
  await withinDeadline(exited);
  const rejected = expect(writer.writeAsync('SELECT 1')).rejects.toThrow(/stopped|closed/i);
  const settled = Promise.all([rejected, writer.shutdown()]);
  await withinDeadline(settled);
  expect(constructed).toHaveBeenCalledTimes(1);
  expectNoMessagePorts();
});

function loadCrashingWriter({ fakeTimers = true } = {}) {
  // A nonexistent parent directory makes the real Worker fail during startup.
  jest.doMock('../src/config', () => ({
    ...jest.requireActual('../src/config'),
    dbPath: path.join(TEST_ROOT, 'missing-writer-directory', 'db.sqlite'),
  }));
  if (fakeTimers) jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'performance'] });
  return require('../src/db/writer');
}

test('shutdown cancels a crash restart and invalidates even an already queued callback', async () => {
  const writer = loadCrashingWriter();
  const scheduled = jest.spyOn(global, 'setTimeout');
  await new Promise(resolve => workers[0].worker.once('exit', resolve));
  expectExited(0, 1);
  const restart = scheduled.mock.calls.find(([, delay]) => delay === 500);
  expect(restart).toBeDefined();
  const bufferedWrite = writer.writeAsync('SELECT 1');
  const rejected = expect(bufferedWrite).rejects.toThrow(/stopped|closed/i);
  const shutdown = writer.shutdown();
  await shutdown;
  await rejected;
  expect(writer.shutdown()).toBe(shutdown);
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(500);
  restart[0](); // Simulate a callback dequeued just before cancellation.
  expect(constructed).toHaveBeenCalledTimes(1);
  expectNoMessagePorts();
});

test('shutdown counts and warns for pending operations rejected after a real Worker startup failure', async () => {
  const writer = loadCrashingWriter({ fakeTimers: false });
  const warn = jest.spyOn(console, 'warn');
  const rejected = expect(writer.writeAsync('SELECT 1')).rejects.toThrow(/stopped|closed/i);
  await withinDeadline(Promise.all([rejected, writer.shutdown()]));
  expect(writer.backpressure.shutdownDiscardedOps).toBe(1);
  expect(writer.backpressure.queueDepth).toBe(0);
  expect(warn).toHaveBeenCalledWith(
    expect.stringMatching(/stopped.*discarded/i), 1, 1, 0,
  );
  expectExited(0, 1);
  expectNoMessagePorts();
});

test('shutdown deduplicates buffered reqIds and counts untracked writes even if cleanup logging throws', async () => {
  const writer = loadCrashingWriter();
  await new Promise(resolve => workers[0].worker.once('exit', resolve));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => { throw new Error('synthetic cleanup logger failure'); });
  const error = jest.spyOn(console, 'error');
  const rejected = expect(writer.writeAsync('SELECT 1')).rejects.toThrow(/stopped|closed/i);
  writer.write('SELECT 2'); // No reqId: buffered only in retryQueue.
  const shutdown = writer.shutdown();
  const settled = expect(withinDeadline(Promise.all([rejected, shutdown]))).resolves.toEqual([undefined, undefined]);
  await jest.advanceTimersByTimeAsync(2000);
  await settled;
  expect(writer.backpressure.shutdownDiscardedOps).toBe(2);
  expect(writer.backpressure.droppedWrites).toBe(1);
  expect(writer.backpressure.queueDepth).toBe(0);
  expect(warn).toHaveBeenCalledWith(
    expect.stringMatching(/stopped.*discarded/i), 2, 1, 1,
  );
  expect(error).toHaveBeenCalledWith('[dbWriter] Shutdown cleanup failed:', 'synthetic cleanup logger failure');
  expect(writer.shutdown()).toBe(shutdown);
  expect(jest.getTimerCount()).toBe(0);
  expect(constructed).toHaveBeenCalledTimes(1);
  expectNoMessagePorts();
});

test('shutdown settles every pending API and resolves even when cleanup metrics throws', async () => {
  const writer = loadCrashingWriter({ fakeTimers: false });
  jest.spyOn(require('../src/utils/prodMetrics'), 'recordSqliteWrite').mockImplementation(() => {
    throw new Error('synthetic cleanup metrics failure');
  });
  const warn = jest.spyOn(console, 'warn');
  const error = jest.spyOn(console, 'error');
  const rejected = [writer.writeAsync('SELECT 1'), writer.writeBatch([]), writer.writeSequencedEvent({})]
    .map(promise => expect(promise).rejects.toThrow(/stopped|closed/i));
  await expect(withinDeadline(Promise.all([...rejected, writer.shutdown()]))).resolves.toEqual([
    undefined, undefined, undefined, undefined,
  ]);
  expect(writer.backpressure.shutdownDiscardedOps).toBe(3);
  expect(writer.backpressure.queueDepth).toBe(0);
  expect(warn).toHaveBeenCalledWith(expect.stringMatching(/stopped.*discarded/i), 3, 3, 0);
  expect(error).toHaveBeenCalledWith('[dbWriter] Shutdown cleanup failed:', 'synthetic cleanup metrics failure');
  expectExited(0, 1);
  expectNoMessagePorts();
});

test('audited reset targets do not load writer; close the app writer before isolated push imports', async () => {
  jest.doMock('../src/utils/redis', () => ({ redis: { rpop: jest.fn(), lpush: jest.fn() } }));
  jest.doMock('../src/utils/getuiPush', () => ({}));
  try {
    require('../src/utils/alerts');
    require('../src/utils/prodMetrics');
    require('../src/modules/notifications/notificationQueue');
    expect(constructed).not.toHaveBeenCalled();
    expect(require.cache[require.resolve('../src/db/writer')]).toBeUndefined();
    require('../src/app'); // push-distribution's helpers import the real app at top level.
    expect(constructed).toHaveBeenCalledTimes(1);
    await shutdownWriterBeforeModuleReset();
    expectExited(0);
    expectNoMessagePorts();
    jest.isolateModules(() => {
      require('../src/utils/getuiPush');
      require('../src/utils/push');
    });
    expect(constructed).toHaveBeenCalledTimes(1);
    expectNoMessagePorts();
  } finally {
    jest.dontMock('../src/utils/redis');
    jest.dontMock('../src/utils/getuiPush');
  }
}, 30000);

test('a nonzero Worker exit while stopping cannot schedule a restart', async () => {
  const writer = loadCrashingWriter();
  await writer.shutdown();
  expectExited(0, 1);
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(500);
  expect(constructed).toHaveBeenCalledTimes(1);
  expectNoMessagePorts();
});

test('the reset helper does nothing when the writer is not cached', async () => {
  expect(require.cache[require.resolve('../src/db/writer')]).toBeUndefined();
  await shutdownWriterBeforeModuleReset();
  expect(require.cache[require.resolve('../src/db/writer')]).toBeUndefined();
  expect(constructed).not.toHaveBeenCalled();
  expectNoMessagePorts();
});

test('the reset helper rejects explicitly at its 5s deadline', async () => {
  const writer = require('../src/db/writer');
  const stalled = jest.spyOn(writer, 'shutdown').mockImplementation(() => new Promise(() => {}));
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'performance'] });
  try {
    const rejected = expect(shutdownWriterBeforeModuleReset()).rejects.toThrow(/timed out after 5000ms/);
    await jest.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    stalled.mockRestore();
    jest.useRealTimers();
    await writer.shutdown();
  }
  expectExited(0);
  expectNoMessagePorts();
});
