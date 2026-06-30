'use strict';
/**
 * 本地文件上传守卫（multer + 三重校验）：
 *   1. Content-Type 白名单（multer fileFilter）
 *   2. 危险扩展名黑名单
 *   3. 魔数（magic bytes）二次校验真实 MIME，杜绝伪装
 * 存储文件名一律 UUID + 从真实 MIME 派生的扩展名，绝不信任 originalname。
 */
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const fileType = require('file-type');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_CHAT_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-zip-compressed',
  'application/x-rar-compressed', 'application/x-7z-compressed',
  'text/plain',
]);

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
]);

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.com', '.scr',
  '.ps1', '.ps2', '.vbs', '.vbe', '.js', '.jse',
  '.sh', '.bash', '.zsh', '.fish',
  '.php', '.php3', '.php4', '.php5', '.phtml',
  '.jsp', '.jspx', '.asp', '.aspx', '.cer', '.asa',
  '.htaccess', '.htpasswd', '.jar', '.war', '.ear',
  '.msi', '.apk', '.ipa', '.deb', '.rpm',
  '.py', '.rb', '.pl', '.lua', '.cgi',
]);

const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'application/pdf': '.pdf', 'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
  'application/x-rar-compressed': '.rar', 'application/x-7z-compressed': '.7z',
  'text/plain': '.txt',
};

function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'file';
  return name
    .replace(/[/\\]/g, '').replace(/\0/g, '').replace(/\.{2,}/g, '.')
    .replace(/[^\w.\-一-龥\s]/g, '_').trim().slice(0, 200) || 'file';
}

async function verifyMagicBytes(filePath, allowedMimes, claimedMime = '') {
  let fd;
  try {
    const buf = Buffer.alloc(16);
    fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd); fd = null;

    const detected = await fileType.fromBuffer(buf.slice(0, bytesRead));
    if (!detected) {
      // 声明为二进制媒体类型(图片/音视频)却无法识别真实魔数 → 内容与声明不符，拒绝
      // （防止文本/脚本伪装成 image/png 等绕过校验被存为媒体消息）
      if (/^(image|video|audio)\//.test(claimedMime)) {
        return { ok: false, reason: `声明为 ${claimedMime} 但文件内容非该类型` };
      }
      if (allowedMimes.has('text/plain')) return { ok: true, mime: 'text/plain' };
      return { ok: false, reason: '无法识别文件类型（可能为可执行文件或未知格式）' };
    }
    if (!allowedMimes.has(detected.mime)) {
      return { ok: false, reason: `文件真实类型为 ${detected.mime}，不在允许范围内` };
    }
    return { ok: true, mime: detected.mime };
  } catch (e) {
    if (fd != null) try { fs.closeSync(fd); } catch {}
    return { ok: false, reason: `魔数校验失败: ${e.message}` };
  }
}

function makeMagicBytesMiddleware(allowedMimes) {
  return async (req, res, next) => {
    const files = req.files || (req.file ? [req.file] : []);
    if (!files.length) return next();
    for (const file of files) {
      const origExt = path.extname(file.originalname).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(origExt)) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: `400 Invalid File Type: 禁止上传 ${origExt} 类型文件` });
      }
      const result = await verifyMagicBytes(file.path, allowedMimes, file.mimetype);
      if (!result.ok) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: `400 Invalid File Type: ${result.reason}` });
      }
      // 用真实检测到的 MIME 覆盖客户端声明的 Content-Type，确保消息类型正确
      if (result.mime) file.mimetype = result.mime;
    }
    next();
  };
}

function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '文件超过大小限制（最大 50MB）' });
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  }
  if (err?.message) return res.status(400).json({ error: err.message });
  next(err);
}

function wrapUpload(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, err => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  };
}

function makeChatUploader(dest) {
  fs.mkdirSync(dest, { recursive: true });
  const storage = multer.diskStorage({
    destination: dest,
    filename: (req, file, cb) => cb(null, uuidv4() + (MIME_TO_EXT[file.mimetype] || '.bin')),
  });
  const multerMw = wrapUpload(multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_CHAT_MIMES.has(file.mimetype)) {
        return cb(new Error(`400 Invalid File Type: 不支持的 Content-Type (${file.mimetype})`));
      }
      cb(null, true);
    },
  }).single('file'));
  return [multerMw, makeMagicBytesMiddleware(ALLOWED_CHAT_MIMES)];
}

function makeImageUploader(dest, fieldName = 'image', maxCount = 1, maxSize = 5 * 1024 * 1024) {
  fs.mkdirSync(dest, { recursive: true });
  const storage = multer.diskStorage({
    destination: dest,
    filename: (req, file, cb) => cb(null, uuidv4() + (MIME_TO_EXT[file.mimetype] || '.jpg')),
  });
  const m = multer({
    storage,
    limits: { fileSize: maxSize },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
        return cb(new Error('400 Invalid File Type: 仅支持图片格式（JPEG/PNG/GIF/WebP）'));
      }
      cb(null, true);
    },
  });
  const middleware = maxCount === 1 ? m.single(fieldName) : m.array(fieldName, maxCount);
  return [wrapUpload(middleware), makeMagicBytesMiddleware(ALLOWED_IMAGE_MIMES)];
}

module.exports = {
  ALLOWED_CHAT_MIMES, ALLOWED_IMAGE_MIMES, MIME_TO_EXT, BLOCKED_EXTENSIONS,
  sanitizeFilename, makeChatUploader, makeImageUploader, verifyMagicBytes,
};
