'use strict';
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
let root, image;
const decision = status => ({ status, scope: 'nudity', model: 'nudenet-320n-3.4.2', frames: 1 });
function worker(output, code = 0) {
  spawn.mockImplementationOnce(() => {
    const child = new EventEmitter(); child.stdout = new PassThrough();
    setImmediate(() => { child.stdout.end(typeof output === 'string' ? output : JSON.stringify(output)); child.emit('close', code); });
    return child;
  });
}
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-scanner-test-')); image = path.join(root, 'image.png');
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toFile(image);
});
beforeEach(() => { spawn.mockReset(); Object.assign(config.mediaModeration, previous, { provider: 'local-nudenet', python: '/synthetic/python' }); });
afterAll(() => { Object.assign(config.mediaModeration, previous); fs.rmSync(root, { recursive: true, force: true }); });

test('a valid decision is required before approval; worker gets no app credentials and temporary frames are removed', async () => {
  worker(decision('approved'));
  await expect(scanner.assertAccepted(image, 'image')).resolves.toMatchObject({ status: 'approved' });
  const [python, args, options] = spawn.mock.calls[0];
  expect(python).toBe('/synthetic/python'); expect(options.shell).toBeUndefined();
  expect(options.env.JWT_SECRET).toBeUndefined(); expect(options.env.ADMIN_PASSWORD).toBeUndefined();
  expect(fs.existsSync(args[args.indexOf('--work-dir') + 1])).toBe(false);
});
test.each(['not JSON', {}, { status: 'approved' }, { ...decision('approved'), frames: 0 }, { ...decision('approved'), scope: 'everything' }])('invalid result fails closed: %j', async output => {
  worker(output);
  await expect(scanner.assertAccepted(image, 'image')).rejects.toMatchObject({ status: 503, code: 'MEDIA_MODERATION_UNAVAILABLE' });
});
test('a blocked decision returns 422 rather than claiming infrastructure failure', async () => {
  worker(decision('blocked'));
  await expect(scanner.assertAccepted(image, 'image')).rejects.toMatchObject({ status: 422, code: 'MEDIA_CONTENT_REJECTED' });
});
test('worker failure never approves even if its stdout says approved', async () => {
  worker(decision('approved'), 1);
  await expect(scanner.assertAccepted(image, 'image')).rejects.toMatchObject({ status: 503 });
});
test('unconfigured scanner refuses before decoding/spawning', async () => {
  config.mediaModeration.provider = '';
  await expect(scanner.assertAccepted(image, 'image')).rejects.toMatchObject({ status: 503 });
  expect(spawn).not.toHaveBeenCalled();
});
test('invalid input bytes fail without claiming an approval', async () => {
  const file = path.join(root, 'bad.png'); fs.writeFileSync(file, 'not a png');
  await expect(scanner.assertAccepted(file, 'image')).rejects.toMatchObject({ status: 400, code: 'INVALID_MEDIA' });
  expect(spawn).not.toHaveBeenCalled();
});

test('timeout kills the worker group, rejects, removes staging and releases the concurrency slot', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.pid = 1234567;
  spawn.mockReturnValueOnce(child);
  config.mediaModeration.timeoutMs = 10;
  const kill = jest.spyOn(process, 'kill').mockImplementation(() => {
    setImmediate(() => child.emit('close', null)); return true;
  });
  try {
    await expect(scanner.assertAccepted(image, 'image')).rejects.toMatchObject({ status: 503 });
    expect(kill).toHaveBeenCalledWith(-1234567, 'SIGKILL');
    const args = spawn.mock.calls[0][1];
    expect(fs.existsSync(args[args.indexOf('--work-dir') + 1])).toBe(false);
  } finally { kill.mockRestore(); config.mediaModeration.timeoutMs = previous.timeoutMs; }
  worker(decision('approved'));
  await expect(scanner.assertAccepted(image, 'image')).resolves.toMatchObject({ status: 'approved' });
});

test('HEVC-encoded HEIC (phone album default) gets an actionable format error, not "corrupt"', async () => {
  const file = path.join(__dirname, 'fixtures', 'photo-hevc.heic');
  await expect(scanner.assertAccepted(file, 'image')).rejects.toMatchObject({ status: 400, code: 'UNSUPPORTED_IMAGE_FORMAT' });
  expect(spawn).not.toHaveBeenCalled();
});
