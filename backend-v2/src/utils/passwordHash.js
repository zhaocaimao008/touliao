'use strict';
/**
 * 密码哈希放到工作线程池计算（接口与 bcryptjs 的 hash / compare 相同，结果格式不变）。
 *
 * bcryptjs 是纯 JS，12 轮一次约 0.3s CPU。在主线程算时，压测 300 人同时登录：
 * 每人平均等 17.5s，且整个服务停顿——/health 中位 4.4s，同时在发的消息确认中位 8.6s。
 * 放进工作线程后主线程不再被占用，吞吐按核数扩展。
 */
const os = require('os');
const { Worker } = require('worker_threads');

const SIZE = Math.max(1, Math.min(4, os.cpus().length - 1));
const WORKER_SOURCE = `
const { parentPort } = require('worker_threads');
const bcrypt = require(${JSON.stringify(require.resolve('bcryptjs'))});
parentPort.on('message', ({ id, op, a, b }) => {
  try { parentPort.postMessage({ id, result: op === 'hash' ? bcrypt.hashSync(a, b) : bcrypt.compareSync(a, b) }); }
  catch (e) { parentPort.postMessage({ id, error: e.message }); }
});`;

const pending = new Map();
let workers = [];
let seq = 0;

function spawn() {
  const w = new Worker(WORKER_SOURCE, { eval: true });
  w.busy = 0;
  w.on('message', ({ id, result, error }) => {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (--w.busy === 0) w.unref();
    if (error) job.reject(new Error(error)); else job.resolve(result);
  });
  w.on('error', (err) => retire(w, err));
  w.on('exit', (code) => retire(w, new Error(`密码哈希线程退出: ${code}`)));
  // 空闲时 unref、有任务时 ref：既不因线程池让进程无法退出，也不会在结果回来前提前退出。
  // 挂 message 监听会重新 ref，所以要放在监听之后。
  w.unref();
  return w;
}

// 线程异常退出：拒绝它手上的任务，下次调用时补一个新线程
function retire(w, err) {
  if (!workers.includes(w)) return;
  workers = workers.filter(x => x !== w);
  for (const [id, job] of pending) if (job.worker === w) { pending.delete(id); job.reject(err); }
}

function run(op, a, b) {
  while (workers.length < SIZE) workers.push(spawn());
  const w = workers.reduce((x, y) => (y.busy < x.busy ? y : x));
  if (w.busy++ === 0) w.ref();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, worker: w });
    w.postMessage({ id, op, a, b });
  });
}

module.exports = {
  hash: (password, rounds) => run('hash', password, rounds),
  compare: (password, hash) => run('compare', password, hash),
  poolSize: SIZE,
};
