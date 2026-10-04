'use strict';
// 常驻审核进程：模型只加载一次；任何协议异常 / 超时 / 崩溃都按不可用拒绝（绝不放行），
// 杀掉整个进程组，下次请求重新拉起。
jest.mock('child_process', () => ({ spawn: jest.fn() }));
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const config = require('../src/config');
const { spawn } = require('child_process');
const scanner = require('../src/modules/moderation/localMediaScanner');
const previous = { ...config.mediaModeration };
const decision = (id, status = 'approved') => ({ id, status, scope: 'nudity', model: 'nudenet-320n-3.4.2', frames: 1 });
let root, image, nextPid = 4000000, kill;

// 模拟常驻进程：reply(req) 返回要回的对象（或字符串原样写出，或 null 不回）
function resident({ ready = { ready: true, model: 'nudenet-320n-3.4.2' }, reply = req => decision(req.id) } = {}) {
  const child = new EventEmitter();
  child.pid = nextPid++; child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.requests = [];
  child.stdin.on('data', buf => {
    for (const line of buf.toString().split('\n').filter(Boolean)) {
      const req = JSON.parse(line); child.requests.push(req);
      const out = reply(req);
      if (out != null) setImmediate(() => child.stdout.write((typeof out === 'string' ? out : JSON.stringify(out)) + '\n'));
    }
  });
  setImmediate(() => { if (ready) child.stdout.write(JSON.stringify(ready) + '\n'); });
  spawn.mockImplementationOnce(() => child);
  return child;
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-resident-test-')); image = path.join(root, 'image.png');
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toFile(image);
});
beforeEach(() => {
  spawn.mockReset();
  Object.assign(config.mediaModeration, previous, { provider: 'local-nudenet', python: '/synthetic/python', resident: true, timeoutMs: 2000 });
  kill = jest.spyOn(process, 'kill').mockImplementation(pid => { return true; });
});
afterEach(() => kill.mockRestore());
afterAll(() => { Object.assign(config.mediaModeration, previous); fs.rmSync(root, { recursive: true, force: true }); });

// 让上一轮测试里存活的常驻进程失效，保证每个用例从干净状态开始
async function resetPool(child) { child.emit('close', null); await new Promise(r => setImmediate(r)); }

test('模型只加载一次：连续审核复用同一常驻进程，且进程拿不到应用凭据', async () => {
  const child = resident();
  await expect(scanner.assertAccepted(image, 'image')).resolves.toMatchObject({ status: 'approved' });
  await expect(scanner.assertAccepted(image, 'image')).resolves.toMatchObject({ status: 'approved' });
  expect(spawn).toHaveBeenCalledTimes(1);
  const [python, args, options] = spawn.mock.calls[0];
  expect(python).toBe('/synthetic/python'); expect(args).toContain('--serve'); expect(options.shell).toBeUndefined();
  expect(options.env.JWT_SECRET).toBeUndefined(); expect(options.env.ADMIN_PASSWORD).toBeUndefined();
  expect(child.requests).toHaveLength(2);
  expect(fs.existsSync(child.requests[0].workDir)).toBe(false); // 临时帧目录已清理
  await resetPool(child);
});

test.each([
  ['结论不完整', req => ({ id: req.id, status: 'approved' })],
  ['请求号对不上', req => decision(req.id + 99)],
  ['非 JSON 输出', () => 'garbage'],
  ['脚本内部错误', req => ({ id: req.id, status: 'error' })],
])('%s → 不放行（503）；协议异常的进程被杀掉，下次重新拉起', async (_, reply) => {
  const bad = resident({ reply });
  await expect(scanner.assertAccepted(image, 'image')).rejects.toMatchObject({ status: 503, code: 'MEDIA_MODERATION_UNAVAILABLE' });
  const good = resident();
  await expect(scanner.assertAccepted(image, 'image')).resolves.toMatchObject({ status: 'approved' });
  await resetPool(good); await resetPool(bad);
});

test('被识别为违规 → 422；损坏文件 → 400', async () => {
  const child = resident({ reply: req => (child.requests.length === 1 ? decision(req.id, 'blocked') : { id: req.id, status: 'invalid' }) });
  await expect(scanner.assertAccepted(image, 'image')).rejects.toMatchObject({ status: 422, code: 'MEDIA_CONTENT_REJECTED' });
  await expect(scanner.assertAccepted(image, 'image')).rejects.toMatchObject({ status: 400, code: 'INVALID_MEDIA' });
  await resetPool(child);
});

test('启动失败或处理超时 → 503，杀掉进程组，并发名额释放', async () => {
  const crashed = resident({ ready: null });
  setImmediate(() => crashed.emit('close', 1));
  await expect(scanner.assertAccepted(image, 'image')).rejects.toMatchObject({ status: 503 });
  config.mediaModeration.timeoutMs = 50;
  const hung = resident({ reply: () => null });
  await expect(scanner.assertAccepted(image, 'image')).rejects.toMatchObject({ status: 503 });
  expect(kill).toHaveBeenCalledWith(-hung.pid, 'SIGKILL');
  config.mediaModeration.timeoutMs = 2000;
  // 并发请求可能各自启动一个常驻进程；为两种调度顺序都准备模拟子进程。
  const next = resident();
  const second = resident();
  await expect(Promise.all([scanner.assertAccepted(image, 'image'), scanner.assertAccepted(image, 'image')])).resolves.toHaveLength(2);
  await resetPool(next);
  await resetPool(second);
});
