'use strict';
/**
 * 本地文件上传守卫：
 *   聊天文件（makeChatUploader）——「常见格式」策略：
 *     1. 按文件扩展名白名单放行常见图片/音视频/文档/压缩包，冷门/危险扩展名直接拒收；
 *     2. 魔数（magic bytes）反伪装：真实内容若为可执行/危险类型（把 .exe 改名成 .mp4），即便扩展名常见也拒收；
 *     3. 下发层再兜底：/uploads 一律 nosniff、非图音视频以附件下发（见 app.js），杜绝存储型 XSS。
 *   图片文件（makeImageUploader，头像/表情/朋友圈）——严格 MIME 白名单 + 魔数二次校验。
 *   存储文件名一律 UUID + 安全派生的扩展名，绝不信任 originalname。
 */
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const fileType = require('file-type');
const { v4: uuidv4 } = require('uuid');

// 单文件上限：默认不限制（Infinity）；如需设安全上限可配环境变量 MAX_UPLOAD_BYTES。
// diskStorage 边收边落盘、不整体入内存，故不限制不会撑爆内存（磁盘占用请自行留意）。
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES, 10) || Infinity;

// 魔数采样字节数：file-type 需足够样本才能识别 webm/ogg/mp3(ID3)/tiff 等（旧代码仅读 16 字节会漏判）。
const MAGIC_SAMPLE_BYTES = 4100;

// 聊天允许的「常见」文件扩展名（人类可读、可预测：常见↔冷门一目了然）。不在此列的一律拒收。
const ALLOWED_CHAT_EXTS = new Set([
  // 图片
  'jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif', 'tif', 'tiff',
  // 视频
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', '3g2', 'ogv',
  // 音频
  'mp3', 'm4a', 'm4b', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma', 'amr', 'mid', 'midi', 'aif', 'aiff',
  // 文档
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'tsv', 'md', 'markdown', 'rtf', 'srt', 'vtt', 'epub',
  // 压缩包
  'zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz', 'tgz',
]);

// 魔数识别出的「可执行/危险」真实类型：即便伪装成常见扩展名也拒收。
const DANGEROUS_DETECTED_MIMES = new Set([
  'application/x-msdownload', 'application/x-dosexec', 'application/vnd.microsoft.portable-executable',
  'application/x-elf', 'application/x-executable', 'application/x-sharedlib', 'application/x-mach-binary',
  'application/wasm', 'application/x-shockwave-flash',
  'application/x-deb', 'application/vnd.debian.binary-package', 'application/x-rpm', 'application/x-msi',
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
  // 可被浏览器渲染/执行的标记语言
  '.html', '.htm', '.xhtml', '.svg', '.svgz', '.xml',
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

// 从原始文件名安全派生存储扩展名（仅 .字母数字，最长 12，防路径穿越/多重扩展）；MIME 已知则优先用映射。
function safeExt(originalname, mimetype) {
  if (MIME_TO_EXT[mimetype]) return MIME_TO_EXT[mimetype];
  const raw = path.extname(originalname || '').toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(raw) ? raw : '.bin';
}

// 读取文件头做魔数识别，返回 {ext,mime} 或 null（识别不出/文件过小/异常均返回 null，不抛）。
async function readMagic(filePath) {
  let fd;
  try {
    const size = fs.statSync(filePath).size;
    const len = Math.min(size, MAGIC_SAMPLE_BYTES);
    if (len === 0) return null;
    const buf = Buffer.alloc(len);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, len, 0);
    fs.closeSync(fd); fd = null;
    try { return await fileType.fromBuffer(buf); } catch { return null; }
  } catch {
    return null;
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch {}
  }
}

// 图片路径专用：真实类型必须落在严格 MIME 白名单内。
async function verifyMagicBytes(filePath, allowedMimes, claimedMime = '') {
  const detected = await readMagic(filePath);
  if (!detected) {
    // 声明为媒体类型却无魔数 → 拒绝
    if (/^(image|video|audio)\//.test(claimedMime)) {
      return { ok: false, reason: `声明为 ${claimedMime} 但文件内容非该类型` };
    }
    // 只有显式声明为 text/plain 且白名单包含 text/plain 时才允许（HTML/SVG/XML 均无魔数，防止绕过）
    if (allowedMimes.has('text/plain') && claimedMime === 'text/plain') {
      return { ok: true, mime: 'text/plain' };
    }
    return { ok: false, reason: '无法识别文件类型（可能为可执行文件或脚本）' };
  }
  if (!allowedMimes.has(detected.mime)) {
    return { ok: false, reason: `文件真实类型为 ${detected.mime}，不在允许范围内` };
  }
  return { ok: true, mime: detected.mime };
}

// 聊天文件校验：扩展名须为常见格式，且真实内容不得为可执行/危险类型。
async function verifyChatFile(filePath, originalname, claimedMime = '') {
  const ext = path.extname(originalname || '').toLowerCase().replace(/^\./, '');
  if (!ALLOWED_CHAT_EXTS.has(ext)) {
    return { ok: false, reason: `不支持的文件格式（${ext ? '.' + ext : '无扩展名'}）；仅支持常见图片/音视频/文档/压缩包` };
  }
  const detected = await readMagic(filePath);
  if (detected && DANGEROUS_DETECTED_MIMES.has(detected.mime)) {
    return { ok: false, reason: `文件真实内容为可执行/危险类型（${detected.mime}）` };
  }
  return { ok: true, ext: '.' + ext, mime: detected?.mime || claimedMime || 'application/octet-stream' };
}

function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '文件超过服务器配置的大小上限' });
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

// 图片路径魔数中间件：危险扩展名黑名单 + 严格 MIME 白名单。
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

// 聊天路径魔数中间件：常见格式扩展名 + 反可执行伪装。
function makeChatMagicMiddleware() {
  return async (req, res, next) => {
    const files = req.files || (req.file ? [req.file] : []);
    if (!files.length) return next();
    for (const file of files) {
      const result = await verifyChatFile(file.path, file.originalname, file.mimetype);
      if (!result.ok) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: `400 Invalid File Type: ${result.reason}` });
      }
      if (result.mime) file.mimetype = result.mime;
    }
    next();
  };
}

function makeChatUploader(dest) {
  fs.mkdirSync(dest, { recursive: true });
  const storage = multer.diskStorage({
    destination: dest,
    filename: (req, file, cb) => cb(null, uuidv4() + safeExt(file.originalname, file.mimetype)),
  });
  const multerMw = wrapUpload(multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_BYTES },
  }).single('file'));
  return [multerMw, makeChatMagicMiddleware()];
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
  ALLOWED_CHAT_EXTS, ALLOWED_IMAGE_MIMES, MIME_TO_EXT, BLOCKED_EXTENSIONS,
  sanitizeFilename, safeExt, makeChatUploader, makeImageUploader,
  verifyMagicBytes, verifyChatFile,
};
