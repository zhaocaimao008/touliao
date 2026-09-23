'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createDownloadService, registerDownloadIPC, safeFilename } = require('../src/lib/downloads');
let server, base;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/forbidden') return res.writeHead(403).end();
    if (req.url === '/redirect') return res.writeHead(302, { Location: '/video' }).end();
    if (req.url === '/slow') return setTimeout(() => res.end('slow video'), 200);
    if (req.url === '/partial') { res.writeHead(200, { 'Content-Length': 100 }); res.write('short'); return setTimeout(() => res.destroy(), 30); }
    if (req.url === '/stream') { res.writeHead(200, { 'Content-Length': 20 }); res.write('first'); return setTimeout(() => res.end('remaining bytes'), 200); }
    res.end(req.url);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); });
function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-download-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const events = [], opened = [], revealed = [];
  const sender = Object.assign(new EventEmitter(), { id: 1, session: { fetch }, isDestroyed: () => false,
    send: (_channel, state) => events.push(state) });
  const serviceOptions = { getDirectory: () => dir, allowedOrigins: () => [base],
    shell: { openPath: async p => opened.push(p), showItemInFolder: p => revealed.push(p) }, noAutoOpenExts: new Set(['.exe']), ...options };
  const service = createDownloadService(serviceOptions);
  const download = (id, url = '/video', filename = id + '.mp4', autoOpen = false) => service.download(sender, { id, url: base + url, filename, autoOpen });
  return { dir, events, opened, revealed, sender, service, download, serviceOptions };
}
test('completes only after bytes are saved, with byte progress and redirects', async t => {
  const x = setup(t); const p = x.download('normal', '/redirect');
  assert.equal(x.events.at(-1).status, 'downloading');
  const result = await p; assert.equal(result.status, 'completed');
  assert.equal(fs.readFileSync(result.savePath, 'utf8'), '/video');
  assert.equal(result.downloadedBytes, 6); assert.deepEqual(x.opened, []);
});
test('HTTP 403 reports failure with no saved file', async t => {
  const x = setup(t), r = await x.download('denied', '/forbidden');
  assert.equal(r.status, 'failed'); assert.match(r.error, /403/); assert.deepEqual(fs.readdirSync(x.dir), []);
});
test('truncated response fails and removes partial file', async t => {
  const x = setup(t); assert.equal((await x.download('partial', '/partial')).status, 'failed');
  assert.deepEqual(fs.readdirSync(x.dir), []);
});
test('cancel before response stops the request', async t => {
  const x = setup(t), p = x.download('slow', '/slow');
  assert.equal(x.service.cancel(x.sender, 'slow'), true);
  assert.equal((await p).status, 'cancelled'); assert.deepEqual(fs.readdirSync(x.dir), []);
});
test('cancel after receiving bytes removes the partial file', async t => {
  const x = setup(t), p = x.download('stream', '/stream');
  while (!x.events.some(e => e.downloadedBytes > 0)) await new Promise(r => setTimeout(r, 5));
  assert.equal(x.service.cancel(x.sender, 'stream'), true);
  assert.equal((await p).status, 'cancelled'); assert.deepEqual(fs.readdirSync(x.dir), []);
});
test('concurrent names and options belong to each request', async t => {
  const x = setup(t); const [first, second] = await Promise.all([x.download('first', '/slow', 'first.mp4', true), x.download('second', '/video', 'second.mp4')]);
  assert.equal(path.basename(first.savePath), 'first.mp4'); assert.equal(fs.readFileSync(first.savePath, 'utf8'), 'slow video');
  assert.equal(path.basename(second.savePath), 'second.mp4'); assert.equal(fs.readFileSync(second.savePath, 'utf8'), '/video');
  assert.deepEqual(x.opened, [first.savePath]);
});
test('parallel identical names never overwrite each other or an existing file', async t => {
  const x = setup(t); fs.writeFileSync(path.join(x.dir, 'same.mp4'), 'original');
  const results = await Promise.all([x.download('one', '/slow', 'same.mp4'), x.download('two', '/video', 'same.mp4')]);
  assert.equal(new Set(results.map(r => r.savePath)).size, 2);
  assert.equal(fs.readFileSync(path.join(x.dir, 'same.mp4'), 'utf8'), 'original');
  assert.deepEqual(results.map(r => fs.readFileSync(r.savePath, 'utf8')), ['slow video', '/video']);
});
test('executable auto-open is replaced with folder reveal', async t => {
  const x = setup(t), r = await x.download('exe', '/video', 'program.exe', true);
  assert.equal(r.status, 'completed'); assert.deepEqual(x.opened, []); assert.deepEqual(x.revealed, [r.savePath]);
});
test('rejects foreign origins, local blobs and embedded credentials before fetching', async t => {
  const x = setup(t); let calls = 0; x.sender.session.fetch = () => { calls++; throw Error('unexpected'); };
  for (const url of ['https://example.invalid/video', 'blob:null/id', 'file:///etc/passwd', base.replace('http://', 'http://user:pass@') + '/video']) {
    assert.equal((await x.service.download(x.sender, { id: 'bad', url })).status, 'failed');
  }
  assert.equal(calls, 0);
});
test('only owning sender can cancel, destruction cancels outstanding transfers', async t => {
  const x = setup(t), p = x.download('slow', '/slow');
  assert.equal(x.service.cancel({ id: 2 }, 'slow'), false);
  x.sender.emit('destroyed'); assert.equal((await p).status, 'cancelled');
  assert.equal(x.sender.listenerCount('destroyed'), 0);
});
test('timeout is a failure and releases the task ID for retry', async t => {
  const x = setup(t, { idleTimeoutMs: 25 });
  const r = await x.download('slow', '/slow'); assert.equal(r.status, 'failed'); assert.match(r.error, /timed out/);
  assert.equal((await x.download('slow')).status, 'completed');
});
test('IPC rejects untrusted senders and exposes explicit failure', async t => {
  const x = setup(t), handlers = new Map();
  registerDownloadIPC({ ...x.serviceOptions, ipcMain: { handle: (n, cb) => handlers.set(n, cb) }, isTrustedSender: e => e.sender === x.sender });
  assert.equal((await handlers.get('file:download')({ sender: {} }, {})).status, 'failed');
  assert.equal(handlers.get('file:cancelDownload')({ sender: {} }, 'id'), false);
});
test('sanitizes Windows names and traversal without losing video extension', () => {
  assert.ok(Buffer.byteLength(safeFilename('视频'.repeat(100) + '.mp4')) <= 240);
  assert.equal(safeFilename('CON.mp4'), '_CON.mp4'); assert.equal(safeFilename('NUL'), '_NUL');
  assert.equal(safeFilename('..'), 'download'); assert.equal(safeFilename('a.mp4. '), 'a.mp4');
  assert.doesNotMatch(safeFilename('../../a:b.mp4'), /[/\\:]/);
  assert.ok(safeFilename('a'.repeat(200) + '.mp4').endsWith('.mp4'));
});
