'use strict';
// Run the installed application's real renderer manager, preload and main IPC on Windows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { _electron: electron } = require('playwright');
const out = path.resolve(__dirname, '../../artifacts/windows-downloads');
fs.mkdirSync(out, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-download-installed-'));
const body = Buffer.from('Touliao native download regression fixture\n'.repeat(32768));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const results = [];
let app;
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/forbidden') return res.writeHead(403).end();
  if (req.url === '/redirect') return res.writeHead(302, { Location: '/normal' }).end();
  if (req.url === '/partial') { res.writeHead(200, { 'Content-Length': body.length * 2 }); res.write(body.subarray(0, 4096)); return setTimeout(() => res.destroy(), 200); }
  const finish = () => { res.writeHead(200, { 'Content-Length': body.length }); res.end(body); };
  if (req.url === '/slow') return setTimeout(finish, 2000);
  if (req.url === '/stream') { res.writeHead(200, { 'Content-Length': body.length }); res.write(body.subarray(0, 4096)); return setTimeout(() => res.end(body.subarray(4096)), 2000); }
  finish();
});
async function poll(fn, label) {
  for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Timeout: ' + label);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  try {
    app = await electron.launch({ executablePath: process.env.TOULIAO_ELECTRON, env: { ...process.env, TOULIAO_LOG_LEVEL: 'info' } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.electronAPI?.downloadFile);
    const runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, electron: process.versions.electron }));
    assert.equal(runtime.version, '8.1.30'); assert.equal(runtime.platform, 'win32'); assert.equal(runtime.packaged, true);
    const base = new URL(await page.evaluate(() => window.electronAPI.getServerUrl())).origin;
    const chunk = await app.evaluate(({ app, session }, { base, local, temp }) => {
      const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
      app.setPath('downloads', temp);
      session.defaultSession.webRequest.onBeforeRequest({ urls: [base + '/__download_regression/*'] }, (details, callback) => {
        callback({ redirectURL: local + new URL(details.url).pathname.replace('/__download_regression', '') });
      });
      const chunks = fs.readdirSync(path.join(app.getAppPath(), 'web/dist/assets')).filter(x => /^share-.*\.js$/.test(x));
      if (chunks.length !== 1) throw Error('Expected one current download chunk');
      return chunks[0];
    }, { base, local, temp });
    await page.evaluate(async chunk => {
      const functions = Object.values(await import('./assets/' + chunk));
      window.downloadSmoke = {
        start: functions.find(fn => fn.toString().includes('mimeType:')),
        retry: functions.find(fn => fn.toString().includes('abortController=new AbortController')),
        cancel: functions.find(fn => fn.toString().includes('abortController.abort()')),
        state: functions.find(fn => /return \w\?\{\.\.\.\w\}:null/.test(fn.toString())),
      };
      if (Object.values(window.downloadSmoke).some(fn => typeof fn !== 'function')) throw Error('Production manager exports not found');
    }, chunk);
    const start = (id, route, filename = id + '.mp4') => page.evaluate(({ id, url, filename }) => window.downloadSmoke.start({ id, fileUrl: url, filename }), { id, url: base + '/__download_regression/' + route, filename });
    const state = id => page.evaluate(id => window.downloadSmoke.state(id), id);
    const done = async id => { await poll(async () => ['completed', 'failed', 'cancelled'].includes((await state(id)).status), id); return state(id); };
    const verified = result => { assert.equal(result.status, 'completed'); assert.equal(hash(fs.readFileSync(result.savePath)), hash(body)); };
    await start('normal', 'normal'); verified(await done('normal')); results.push('saved bytes and hash');
    await start('denied', 'forbidden'); assert.match((await done('denied')).error, /403/); assert.ok(!fs.existsSync(path.join(temp, 'denied.mp4'))); results.push('HTTP 403 failure');
    await start('partial', 'partial'); assert.equal((await done('partial')).status, 'failed'); assert.ok(!fs.existsSync(path.join(temp, 'partial.mp4'))); results.push('truncated body cleanup');
    await start('slow', 'slow'); assert.equal((await state('slow')).status, 'downloading');
    await page.evaluate(() => window.downloadSmoke.cancel('slow')); assert.equal((await done('slow')).status, 'cancelled'); assert.ok(!fs.existsSync(path.join(temp, 'slow.mp4'))); results.push('cancel before response');
    await start('stream', 'stream'); await poll(async () => (await state('stream')).downloadedBytes > 0, 'progress');
    assert.ok((await state('stream')).progress < 100); await page.evaluate(() => window.downloadSmoke.cancel('stream'));
    assert.equal((await done('stream')).status, 'cancelled'); assert.ok(!fs.existsSync(path.join(temp, 'stream.mp4')));
    await page.evaluate(() => window.downloadSmoke.retry('stream')); verified(await done('stream')); results.push('byte progress, cancellation and retry');
    await start('first', 'slow', 'first-video.mp4'); await start('second', 'normal', 'second-video.mp4');
    const first = await done('first'), second = await done('second'); verified(first); verified(second);
    assert.equal(path.basename(first.savePath), 'first-video.mp4'); assert.equal(path.basename(second.savePath), 'second-video.mp4'); results.push('concurrent names remain independent');
    fs.writeFileSync(path.join(temp, 'same.mp4'), 'existing'); await start('same1', 'stream', 'same.mp4'); await start('same2', 'normal', 'same.mp4');
    const same1 = await done('same1'), same2 = await done('same2'); verified(same1); verified(same2);
    assert.notEqual(same1.savePath, same2.savePath); assert.equal(fs.readFileSync(path.join(temp, 'same.mp4'), 'utf8'), 'existing'); results.push('same-name files do not overwrite');
    await start('reserved', 'normal', 'CON.mp4'); const reserved = await done('reserved'); verified(reserved); assert.equal(path.basename(reserved.savePath), '_CON.mp4'); results.push('Windows reserved filename');
    await start('redirect', 'redirect'); verified(await done('redirect')); results.push('HTTP redirect');
    for (const url of ['blob:null/missing', 'file:///C:/Windows/win.ini', 'https://example.invalid/video.mp4']) {
      const rejected = await page.evaluate(url => window.electronAPI.downloadFile(url, 'unsafe.mp4', false, crypto.randomUUID()), url);
      assert.equal(rejected.status, 'failed');
    }
    results.push('unsafe origins rejected by real IPC');
    await page.screenshot({ path: path.join(out, 'installed-client.png') });
    const report = { passed: true, runtime, checks: results, bytesPerNormalFile: body.length, sha256: hash(body), note: 'Real installed application; only fixture download URLs redirected to an isolated local HTTP server. No production accounts or messages.' };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ passed: false, error: error.stack, completedChecks: results }, null, 2)); process.exitCode = 1; });
