'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { app, request, makeUser, befriend, privateConversation } = require('./f02-inprocess-http.cjs');
const { db } = require('../src/db/connection');
const config = require('../src/config');
const { ApiError } = require('../src/utils/http');
const scanner = require('../src/modules/moderation/localMediaScanner');
const previous = { ...config.mediaModeration };
const accepted = { status: 'approved', scope: 'nudity', model: 'nudenet-320n-3.4.2', frames: 1 };
let a, b, cid, png, scan;
const auth = req => req.set('Authorization', `Bearer ${a.token}`);
const messageCount = () => db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n;
const names = dir => fs.readdirSync(path.join(config.uploadsRoot, dir)).sort();

beforeAll(async () => {
  Object.assign(config.mediaModeration, { provider: 'local-nudenet', python: '/synthetic/python' });
  a = await makeUser({ username: 'media-enabled-a' }); b = await makeUser({ username: 'media-enabled-b' });
  await befriend(a, b); cid = await privateConversation(a, b);
  png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#37aaff' } }).png().toBuffer();
  scan = jest.spyOn(scanner, 'assertAccepted');
});
beforeEach(() => { scan.mockReset(); scan.mockResolvedValue(accepted); });
afterAll(async () => { scan.mockRestore(); Object.assign(config.mediaModeration, previous); await require('../src/db/writer').shutdown(); });

test.each([['photo.png', 'image/png'], ['renamed.txt', 'text/plain']])('approved %s is scanned by actual MIME and delivered as an image', async (filename, contentType) => {
  const before = messageCount();
  const r = await auth(request(app).post(`/api/messages/${cid}/upload`)).attach('file', png, { filename, contentType });
  expect(r.status).toBe(200); expect(r.body.type).toBe('image');
  expect(scan).toHaveBeenCalledWith(expect.any(String), 'image');
  expect(messageCount()).toBe(before + 1);
  expect(db.prepare('SELECT path FROM file_registry WHERE path=?').get(r.body.file_url)).toBeTruthy();
  expect(fs.existsSync(path.join(config.uploadsRoot, r.body.file_url.replace('/uploads/', '')))).toBe(true);
});

test.each([
  ['/api/users/avatar', 'avatar'], ['/api/users/cover', 'cover'],
  ['/api/moments/images', 'images'], ['background', 'file'],
])('approved images work at %s and leave no staging file', async (route, field) => {
  const url = route === 'background' ? `/api/messages/conversation/${cid}/background-upload` : route;
  const before = names('.media-pending');
  scan.mockImplementation(async file => {
    expect(file).toContain('/.media-pending/');
    expect((await auth(request(app).get(`/uploads/.media-pending/${path.basename(file)}`))).status).toBe(404);
    return accepted;
  });
  const r = await auth(request(app).post(url)).attach(field, png, { filename: 'photo.png', contentType: 'image/png' });
  expect(r.status).toBe(200); expect(scan).toHaveBeenCalledTimes(1);
  expect(names('.media-pending')).toEqual(before);
});

test.each([[422, 'MEDIA_CONTENT_REJECTED'], [503, 'MEDIA_MODERATION_UNAVAILABLE']])('chat rejects scanner failure %s without files, registry entries, or messages', async (status, code) => {
  const before = messageCount(), files = names('files');
  const registry = db.prepare('SELECT COUNT(*) n FROM file_registry').get().n;
  scan.mockRejectedValue(new ApiError(status, 'synthetic review rejection', code));
  const r = await auth(request(app).post(`/api/messages/${cid}/upload`)).attach('file', png, { filename: 'photo.png', contentType: 'image/png' });
  expect(r.status).toBe(status); expect(r.body.error_code).toBe(code);
  expect(messageCount()).toBe(before); expect(names('files')).toEqual(files);
  expect(db.prepare('SELECT COUNT(*) n FROM file_registry').get().n).toBe(registry);
});

test('a rejected image removes the entire multipart batch before any file is published', async () => {
  const pending = names('.media-pending'), published = names('moments');
  scan.mockResolvedValueOnce(accepted).mockRejectedValueOnce(new ApiError(422, 'synthetic rejection', 'MEDIA_CONTENT_REJECTED'));
  const r = await auth(request(app).post('/api/moments/images'))
    .attach('images', png, { filename: 'one.png', contentType: 'image/png' })
    .attach('images', png, { filename: 'two.png', contentType: 'image/png' });
  expect(r.status).toBe(422); expect(names('.media-pending')).toEqual(pending); expect(names('moments')).toEqual(published);
});

test('an invalid multipart image clears every staged file without calling the scanner', async () => {
  const pending = names('.media-pending');
  const r = await auth(request(app).post('/api/moments/images'))
    .attach('images', png, { filename: 'valid.png', contentType: 'image/png' })
    .attach('images', Buffer.from('not an image'), { filename: 'invalid.png', contentType: 'image/png' });
  expect(r.status).toBe(400); expect(names('.media-pending')).toEqual(pending); expect(scan).not.toHaveBeenCalled();
});

test.each([false, true])('chunk completion waits for the scanner before publishing (reject=%s)', async reject => {
  const bytes = await sharp(png).jpeg().toBuffer();
  const before = messageCount(), files = names('files');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const init = await auth(request(app).post(`/api/messages/${cid}/upload-init`)).send({ filename: 'photo.jpg', size: bytes.length, hash, mime: 'image/jpeg' });
  expect(init.status).toBe(200);
  const id = init.body.uploadId;
  expect((await auth(request(app).put(`/api/messages/${cid}/upload-chunk/${id}?offset=0`)).set('Content-Type', 'application/octet-stream').send(bytes)).status).toBe(200);
  if (reject) scan.mockRejectedValue(new ApiError(422, 'synthetic rejection', 'MEDIA_CONTENT_REJECTED'));
  const r = await auth(request(app).post(`/api/messages/${cid}/upload-finish/${id}`));
  expect(r.status).toBe(reject ? 422 : 200);
  expect(messageCount()).toBe(before + (reject ? 0 : 1));
  for (const ext of ['.part', '.meta.json']) expect(fs.existsSync(path.join(config.uploadsRoot, 'chunks', id + ext))).toBe(false);
  if (reject) expect(names('files')).toEqual(files);
  else expect(r.body.type).toBe('image');
});

test('anonymous visual upload still requires authentication before review', async () => {
  expect((await request(app).post('/api/users/avatar')).status).toBe(401);
  expect(scan).not.toHaveBeenCalled();
});

test('a chunk under review cannot be reinitialized, appended to, or completed twice', async () => {
  const hash = crypto.createHash('sha256').update(png).digest('hex');
  const body = { filename: 'photo.png', size: png.length, hash, mime: 'image/png' };
  const init = await auth(request(app).post(`/api/messages/${cid}/upload-init`)).send(body);
  const id = init.body.uploadId;
  await auth(request(app).put(`/api/messages/${cid}/upload-chunk/${id}?offset=0`)).set('Content-Type', 'application/octet-stream').send(png);
  let release, entered;
  const running = new Promise(resolve => { entered = resolve; });
  scan.mockImplementationOnce(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const before = messageCount();
  const first = auth(request(app).post(`/api/messages/${cid}/upload-finish/${id}`)).then(r => r);
  await running;
  try {
    expect((await auth(request(app).post(`/api/messages/${cid}/upload-init`)).send(body)).status).toBe(409);
    expect((await auth(request(app).put(`/api/messages/${cid}/upload-chunk/${id}?offset=${png.length}`)).set('Content-Type', 'application/octet-stream').send(png)).status).toBe(409);
    expect((await auth(request(app).post(`/api/messages/${cid}/upload-finish/${id}`))).status).toBe(409);
    expect(messageCount()).toBe(before);
  } finally { release(accepted); }
  expect((await first).status).toBe(200); expect(messageCount()).toBe(before + 1);
});
