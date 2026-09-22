'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const config = require('../../config');
const { ApiError } = require('../../utils/http');

let active = 0;
const worker = path.resolve(__dirname, '../../../scripts/media-moderation/scan.py');
const unavailable = () => new ApiError(503, '图片/视频审核服务暂时不可用，请稍后重试', 'MEDIA_MODERATION_UNAVAILABLE');
function assertConfigured() {
  const c = config.mediaModeration;
  if (c.provider !== 'local-nudenet' || !path.isAbsolute(c.python)) throw unavailable();
}

// Run without a shell or inherited application credentials. Kill the process
// group on timeout, including ffmpeg; the caller then removes its private temp dir.
function runWorker(args) {
  const c = config.mediaModeration;
  return new Promise((resolve, reject) => {
    let output = '', failure;
    const child = spawn(c.python, [worker, ...args, '--threshold', String(c.minScore), '--max-frames', String(c.maxFrames)], {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONNOUSERSITE: '1', OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' },
    });
    const stop = () => {
      failure = unavailable();
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch { /* already exited */ }
    };
    const timer = setTimeout(stop, c.timeoutMs);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 8192) stop();
    });
    child.once('error', () => { failure = unavailable(); });
    child.once('close', code => {
      clearTimeout(timer);
      if (failure || code !== 0) return reject(failure || unavailable());
      try {
        const result = JSON.parse(output);
        if (result.status === 'invalid') throw new ApiError(400, '图片或视频损坏，或格式无法解析', 'INVALID_MEDIA');
        if (!['approved', 'blocked'].includes(result.status) || result.scope !== 'nudity'
          || result.model !== 'nudenet-320n-3.4.2' || !Number.isInteger(result.frames)
          || result.frames < 1 || result.frames > c.maxFrames) throw unavailable();
        resolve(result);
      } catch (err) { reject(err instanceof ApiError ? err : unavailable()); }
    });
  });
}

async function scanFile(filePath, kind) {
  assertConfigured();
  const c = config.mediaModeration;
  if (active >= c.maxConcurrent) throw new ApiError(503, '媒体审核繁忙，请稍后重试', 'MEDIA_MODERATION_BUSY');
  if (!['image', 'video'].includes(kind)) throw unavailable();
  active++;
  let temp;
  try {
    temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'touliao-media-scan-'));
    if (kind === 'image') {
      try {
        const options = { limitInputPixels: 40_000_000, failOn: 'error' };
        const meta = await sharp(filePath, options).metadata();
        const pages = meta.pages || 1;
        const n = Math.min(pages, c.maxFrames);
        for (let i = 0; i < n; i++) {
          const page = n === 1 ? 0 : Math.round(i * (pages - 1) / (n - 1));
          await sharp(filePath, { ...options, page, pages: 1 }).rotate()
            .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
            .jpeg().toFile(path.join(temp, `${String(i).padStart(3, '0')}.jpg`));
        }
      } catch { throw new ApiError(400, '图片损坏、尺寸过大或格式无法解析', 'INVALID_MEDIA'); }
    }
    return await runWorker(['--kind', kind, '--input', path.resolve(filePath), '--work-dir', temp]);
  } finally {
    try { if (temp) await fs.promises.rm(temp, { recursive: true, force: true }); }
    finally { active--; }
  }
}

async function assertAccepted(filePath, kind) {
  const result = await scanFile(filePath, kind);
  if (result.status !== 'approved') throw new ApiError(422, '图片或视频包含不适宜内容，上传已拒绝', 'MEDIA_CONTENT_REJECTED');
  return result;
}

module.exports = { assertConfigured, scanFile, assertAccepted };
