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
const { verifyMagicBytes, ALLOWED_CHAT_MIMES, MIME_TO_EXT, BLOCKED_EXTENSIONS, sanitizeFilename } = require('../../utils/upload');

const MAX_FILE = parseInt(process.env.MAX_UPLOAD_BYTES, 10) || 200 * 1024 * 1024; // 默认上限 200MB
const MAX_CHUNK = 8 * 1024 * 1024; // 单片上限 8MB
const CHUNK_DIR = path.join(config.uploadsRoot, 'chunks');
const FILES_DIR = path.join(config.uploadsRoot, 'files');
fs.mkdirSync(CHUNK_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

const meta = new Map(); // uploadId -> {userId,convId,filename,size,mime,hash}
const partPath = (id) => path.join(CHUNK_DIR, id + '.part');
const received = (id) => { try { return fs.statSync(partPath(id)).size; } catch { return 0; } };
const makeId = (userId, convId, hash) =>
  crypto.createHash('sha1').update(`${userId}:${convId}:${hash}`).digest('hex');

function init(req, res) {
  const { conversationId } = req.params;
  const { filename, size, hash, mime } = req.body || {};
  if (!isMember(conversationId, req.user.id)) return res.status(403).json({ error: '无权上传至该会话' });
  if (!filename || !size || !hash) return res.status(400).json({ error: '参数缺失: filename,size,hash' });
  const total = parseInt(size, 10);
  if (!(total > 0) || total > MAX_FILE) return res.status(400).json({ error: `文件大小需为 1 ~ ${Math.floor(MAX_FILE/1024/1024)}MB` });
  const ext = path.extname(filename).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) return res.status(400).json({ error: `禁止上传 ${ext} 类型文件` });
  const id = makeId(req.user.id, conversationId, hash);
  meta.set(id, { userId: req.user.id, convId: conversationId, filename, size: total, mime: mime || '', hash });
  return res.json({ uploadId: id, received: received(id), chunkSize: MAX_CHUNK });
}

function status(req, res) {
  const { uploadId } = req.params;
  return res.json({ received: received(uploadId), size: meta.get(uploadId)?.size || null });
}

function chunk(req, res) {
  const { uploadId } = req.params;
  const m = meta.get(uploadId);
  if (!m || m.userId !== req.user.id) return res.status(404).json({ error: '上传会话不存在或已过期，请重新 init' });
  const offset = parseInt(req.query.offset, 10) || 0;
  const cur = received(uploadId);
  if (offset !== cur) return res.status(409).json({ error: '偏移不一致，请按 received 续传', received: cur }); // 幂等续传
  const body = req.body; // express.raw -> Buffer
  if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: '空分片' });
  if (body.length > MAX_CHUNK) return res.status(413).json({ error: '单片过大' });
  if (cur + body.length > m.size) return res.status(400).json({ error: '超出声明大小' });
  fs.appendFileSync(partPath(uploadId), body);
  return res.json({ received: received(uploadId) });
}

async function finish(req, res) {
  const { conversationId, uploadId } = req.params;
  const m = meta.get(uploadId);
  if (!m || m.userId !== req.user.id) return res.status(404).json({ error: '上传会话不存在' });
  if (!isMember(conversationId, req.user.id)) return res.status(403).json({ error: '无权发送' });
  const part = partPath(uploadId);
  const got = received(uploadId);
  if (got !== m.size) return res.status(400).json({ error: `文件不完整 (${got}/${m.size})，请续传`, received: got });

  // 魔数校验（与单次上传一致的安全策略）
  const check = await verifyMagicBytes(part, ALLOWED_CHAT_MIMES, m.mime);
  if (!check.ok) { fs.unlink(part, () => {}); meta.delete(uploadId); return res.status(400).json({ error: `400 Invalid File Type: ${check.reason}` }); }

  // hash 完整性校验
  const realHash = crypto.createHash('sha256').update(fs.readFileSync(part)).digest('hex');
  if (m.hash && /^[a-f0-9]{64}$/i.test(m.hash) && realHash.toLowerCase() !== m.hash.toLowerCase()) {
    fs.unlink(part, () => {}); meta.delete(uploadId);
    return res.status(400).json({ error: '文件校验失败(hash 不一致)' });
  }

  const finalName = require('uuid').v4() + (MIME_TO_EXT[check.mime] || path.extname(m.filename) || '.bin');
  const finalPath = path.join(FILES_DIR, finalName);
  fs.renameSync(part, finalPath);
  meta.delete(uploadId);

  const mime = check.mime || m.mime || '';
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'voice' : mime.startsWith('video/') ? 'video' : 'file';
  const fileUrl = `/uploads/files/${finalName}`;

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
      if (now - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.unlink(p, () => {});
    }
  } catch {}
}
setInterval(sweep, 3600 * 1000).unref?.();

module.exports = { init, status, chunk, finish, MAX_CHUNK, MAX_FILE };
