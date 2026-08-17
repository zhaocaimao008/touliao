'use strict';
// 分片 / 断点续传上传（自包含本地实现，无需云存储）。
// 协议：
//   init    POST /api/messages/:cid/upload-init      {filename,size,hash,mime}     -> {uploadId, received}
//   chunk   PUT  /api/messages/:cid/upload-chunk/:id (raw body, ?offset=N)         -> {received}
//   status  GET  /api/messages/:cid/upload-status/:id                              -> {received,size}
//   finish  POST /api/messages/:cid/upload-finish/:id {reply_to_id}                -> 消息对象(file_url)
// 断点续传：同一 (user+conv+hash) 复用同一 uploadId；received 以磁盘 .part 实际大小为准，进程重启亦可续传。

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../../config');
const { isMember } = require('../messages/shared');
const { verifyChatFile, ALLOWED_CHAT_EXTS, sanitizeFilename, MAX_UPLOAD_BYTES, MAX_CONCURRENT_UPLOADS, MIN_DISK_FREE_BYTES } = require('../../utils/upload');
const { registerFile } = require('../../utils/fileRegistry');

const MAX_FILE = MAX_UPLOAD_BYTES; // 单文件上限（默认 200MB，可配 MAX_UPLOAD_BYTES）
const MAX_CHUNK = 8 * 1024 * 1024; // 单片上限 8MB
const CHUNK_DIR = path.join(config.uploadsRoot, 'chunks');
const FILES_DIR = path.join(config.uploadsRoot, 'files');
fs.mkdirSync(CHUNK_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

// 磁盘剩余空间阈值检查：低于 MIN_DISK_FREE_BYTES 拒绝新上传/续传
function diskSafe() {
  try {
    if (typeof fs.statfsSync !== 'function') return true;
    const s = fs.statfsSync(config.uploadsRoot);
    const free = s.bavail * s.bsize;
    return free >= MIN_DISK_FREE_BYTES;
  } catch { return true; } // 无法探测时放行（不因统计失败误伤）
}

const meta = new Map(); // uploadId -> {userId,convId,filename,size,mime,hash,createdAt}
const metaPath = (id) => path.join(CHUNK_DIR, id + '.meta.json');
const partPath = (id) => path.join(CHUNK_DIR, id + '.part');

function loadMeta(uploadId) {
  if (meta.has(uploadId)) return meta.get(uploadId);
  try {
    const m = JSON.parse(fs.readFileSync(metaPath(uploadId), 'utf8'));
    meta.set(uploadId, m);
    return m;
  } catch { return null; }
}

// 每小时清理超过 24h 未完成的上传元数据（磁盘 .part 有 sweep 清理，内存 Map 同步清理）
setInterval(() => {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const [id, m] of meta) { if (m.createdAt < cutoff) meta.delete(id); }
}, 3600 * 1000).unref?.();
const received = (id) => { try { return fs.statSync(partPath(id)).size; } catch { return 0; } };
const makeId = (userId, convId, hash) =>
  crypto.createHash('sha1').update(`${userId}:${convId}:${hash}`).digest('hex');

function init(req, res) {
  const { conversationId } = req.params;
  const { filename, size, hash, mime } = req.body || {};
  if (!isMember(conversationId, req.user.id)) return res.status(403).json({ error: '无权上传至该会话' });
  if (!filename || !size || !hash) return res.status(400).json({ error: '参数缺失: filename,size,hash' });
  const total = parseInt(size, 10);
  if (!(total > 0) || total > MAX_FILE) {
    return res.status(400).json({ error: `文件大小需为 1 ~ ${Math.floor(MAX_FILE / 1024 / 1024)}MB` });
  }
  // P1-03：磁盘剩余空间阈值（防磁盘耗尽 DoS）
  if (!diskSafe()) return res.status(503).json({ error: '服务器磁盘空间不足，请稍后再试' });
  // P1-03：单用户并发分片上传会话数上限（防多路小文件叠堆）
  let active = 0;
  for (const m of meta.values()) if (m.userId === req.user.id) active += 1;
  if (active >= MAX_CONCURRENT_UPLOADS) {
    return res.status(429).json({ error: `同时进行中的上传过多（上限 ${MAX_CONCURRENT_UPLOADS}），请先完成或等待清理` });
  }
  // 仅放行常见格式（按扩展名快速拒绝冷门/危险格式；finish 时再做魔数反伪装校验）。
  const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
  if (!ALLOWED_CHAT_EXTS.has(ext)) {
    return res.status(400).json({ error: `不支持的文件格式（${ext ? '.' + ext : '无扩展名'}）；仅支持常见图片/音视频/文档/压缩包` });
  }
  const id = makeId(req.user.id, conversationId, hash);
  const m = { userId: req.user.id, convId: conversationId, filename, size: total, mime: mime || '', hash, createdAt: Date.now() };
  meta.set(id, m);
  fs.writeFileSync(metaPath(id), JSON.stringify(m));
  return res.json({ uploadId: id, received: received(id), chunkSize: MAX_CHUNK });
}

// uploadId 格式验证：必须是 sha1 hex（40位小写十六进制），防止路径穿越
function validateUploadId(uploadId) {
  return typeof uploadId === 'string' && /^[0-9a-f]{40}$/.test(uploadId);
}

function status(req, res) {
  const { uploadId } = req.params;
  if (!validateUploadId(uploadId)) return res.status(400).json({ error: '无效的上传ID' });
  const m = loadMeta(uploadId);
  if (!m || m.userId !== req.user.id) return res.status(404).json({ error: '上传会话不存在或已过期' });
  return res.json({ received: received(uploadId), size: m.size });
}

async function chunk(req, res) {
  const { uploadId } = req.params;
  if (!validateUploadId(uploadId)) return res.status(400).json({ error: '无效的上传ID' });
  const m = loadMeta(uploadId);
  if (!m || m.userId !== req.user.id) return res.status(404).json({ error: '上传会话不存在或已过期，请重新 init' });
  const offset = parseInt(req.query.offset, 10) || 0;
  const cur = received(uploadId);
  if (offset !== cur) return res.status(409).json({ error: '偏移不一致，请按 received 续传', received: cur }); // 幂等续传
  const body = req.body; // express.raw -> Buffer
  if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: '空分片' });
  if (body.length > MAX_CHUNK) return res.status(413).json({ error: '单片过大' });
  if (cur + body.length > m.size) return res.status(400).json({ error: '超出声明大小' });
  if (!diskSafe()) return res.status(503).json({ error: '服务器磁盘空间不足，请稍后再试' });
  await fs.promises.appendFile(partPath(uploadId), body);
  return res.json({ received: received(uploadId) });
}

async function finish(req, res) {
  const { conversationId, uploadId } = req.params;
  if (!validateUploadId(uploadId)) return res.status(400).json({ error: '无效的上传ID' });
  const m = loadMeta(uploadId);
  if (!m || m.userId !== req.user.id) return res.status(404).json({ error: '上传会话不存在' });
  if (conversationId !== m.convId) return res.status(400).json({ error: '会话不匹配' });
  if (!isMember(conversationId, req.user.id)) return res.status(403).json({ error: '无权发送' });
  const part = partPath(uploadId);
  const got = received(uploadId);
  if (got !== m.size) return res.status(400).json({ error: `文件不完整 (${got}/${m.size})，请续传`, received: got });

  // 常见格式校验（扩展名白名单 + 魔数反可执行伪装）
  const check = await verifyChatFile(part, m.filename, m.mime);
  if (!check.ok) { fs.unlink(part, () => {}); meta.delete(uploadId); return res.status(400).json({ error: `400 Invalid File Type: ${check.reason}` }); }

  // hash 完整性校验（流式读取，避免大文件全量载入内存）
  const realHash = await new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(part).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
  if (m.hash && /^[a-f0-9]{64}$/i.test(m.hash) && realHash.toLowerCase() !== m.hash.toLowerCase()) {
    fs.unlink(part, () => {}); meta.delete(uploadId);
    return res.status(400).json({ error: '文件校验失败(hash 不一致)' });
  }

  const finalName = require('uuid').v4() + check.ext; // check.ext = 已校验的常见扩展名（保留 docx/mkv 等原格式）
  const finalPath = path.join(FILES_DIR, finalName);
  fs.renameSync(part, finalPath);
  meta.delete(uploadId);
  fs.unlink(metaPath(uploadId), () => {});

  const mime = check.mime || m.mime || '';
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'voice' : mime.startsWith('video/') ? 'video' : 'file';
  const fileUrl = `/uploads/files/${finalName}`;
  registerFile({ path: fileUrl, ownerId: req.user.id, conversationId, kind: 'files' });

  const svc = require('../messages/messages.service');
  const io = req.app.get('io');
  const msg = await svc.saveUploadedFile(io, conversationId, req.user.id, {
    type, content: sanitizeFilename(m.filename), fileUrl, reply_to_id: req.body?.reply_to_id,
  });
  return res.json(msg);
}

// 清理 24h 前的残留分片
function sweep() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(CHUNK_DIR)) {
      const p = path.join(CHUNK_DIR, f);
      try { if (now - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.unlink(p, () => {}); } catch {}
    }
  } catch {}
}
setInterval(sweep, 3600 * 1000).unref?.();

// 测试辅助：删除指定 uploadId 的内存 meta（用于并发上限用例的清理，避免污染其他用例）
function __testDeleteMeta(uploadId) {
  meta.delete(uploadId);
}

// 测试辅助：删除指定用户的所有内存 meta（用例前重置并发计数）
function __testResetForUser(userId) {
  for (const [id, m] of meta) if (m.userId === userId) meta.delete(id);
}

module.exports = { init, status, chunk, finish, MAX_CHUNK, MAX_FILE, __testDeleteMeta, __testResetForUser };
