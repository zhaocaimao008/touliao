'use strict';
/**
 * 本地文件上传守卫：
 *   聊天文件（makeChatUploader）——「常见格式」策略：
 *     1. 按文件扩展名白名单放行常见图片/音视频/文档/压缩包，冷门/危险扩展名直接拒收；
 *     2. 魔数（magic bytes）反伪装：真实内容若为可执行/危险类型（把 .exe 改名成 .mp4），即便扩展名常见也拒收；
 *     3. 下发层再兜底：/uploads 一律 nosniff、非图音视频以附件下发（见 app.js），杜绝存储型 XSS。
 *   图片文件（makeImageUploader，头像/表情/朋友圈）——严格 MIME 白名单 + 魔数二次校验。
 *   存储文件名一律 UUID + 安全派生的扩展名，绝不信任 originalname。
 *   图片落盘后统一剥离 EXIF/GPS 元数据（见 stripImageMetadata），不影响画面内容。
 */
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const fileType = require('file-type');
const sharp    = require('sharp');
const { v4: uuidv4 } = require('uuid');

// 单文件上限：环境变量覆盖，默认 200 MB。
// diskStorage 边收边落盘不撑爆内存，但无上限会被恶意用户耗尽磁盘（DoS）。
// 200 MB 对聊天文件（视频/文档）已充足；生产如需更大可设 MAX_UPLOAD_BYTES=524288000。
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES, 10) || (200 * 1024 * 1024);

// 单用户同时进行中的分片上传会话上限（防并发小文件叠堆耗尽磁盘/内存）
const MAX_CONCURRENT_UPLOADS = 5;

// 磁盘剩余空间安全阈值：低于该值拒绝新上传（防磁盘耗尽 DoS）
const MIN_DISK_FREE_BYTES = 500 * 1024 * 1024; // 500MB

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

// 浏览器会内联渲染/执行的危险 MIME（结构化 +xml 类型另在 isBrowserRenderableType 里判定）。
const DANGEROUS_RENDER_MIMES = new Set([
  'text/html', 'application/xhtml+xml',
  'application/xml', 'text/xml', 'image/svg+xml',
  'application/javascript', 'text/javascript', 'application/x-javascript',
  'application/ecmascript', 'text/ecmascript',
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

// 仅用于「消息显示内容/下载文件名」（物理文件一律 uuid 命名，非路径安全边界）。
// 故只去除真正危险的字符（路径分隔符、null、控制字符）并收敛多重点号；
// 保留中文标点、括号【】（）、空格及其它语言文字，避免把正常文件名打成一串下划线。
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'file';
  return name
    .replace(/[/\\]/g, '')            // 路径分隔符
    .replace(/[\x00-\x1f\x7f]/g, '')  // null 与控制字符
    .replace(/\.{2,}/g, '.')          // 收敛 .. 多重点号
    .trim().slice(0, 200) || 'file';
}

// multer(busboy) 默认按 latin1 解码 multipart 文件名，浏览器 FormData 发的 UTF-8 中文名会变乱码。
// 还原：把每字符当作原始字节按 latin1 取回，再按 utf8 解码。纯 ASCII 为无损恒等；含中文则修复乱码。
// 仅用于 multipart 单次上传路径（云直传/分片的文件名走 JSON，本就是正确 utf8，无需处理）。
function decodeMultipartName(name) {
  if (!name || typeof name !== 'string') return name;
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    // utf8 解码若产生替换符（�）说明原本就不是被误解码的 utf8，保持原样更安全
    return fixed.includes('�') ? name : fixed;
  } catch { return name; }
}

// 从原始文件名安全派生存储扩展名（仅 .字母数字，最长 12，防路径穿越/多重扩展）；MIME 已知则优先用映射。
function safeExt(originalname, mimetype) {
  if (MIME_TO_EXT[mimetype]) return MIME_TO_EXT[mimetype];
  const raw = path.extname(originalname || '').toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(raw) ? raw : '.bin';
}

// 读取文件头做魔数识别，返回 {ext,mime} 或 null（识别不出/文件过小/异常均返回 null，不抛）。
// 使用 fs.promises 异步 I/O，避免在 async middleware 中阻塞 Node 事件循环。
async function readMagic(filePath) {
  let fh;
  try {
    const stat = await fs.promises.stat(filePath);
    const len = Math.min(stat.size, MAGIC_SAMPLE_BYTES);
    if (len === 0) return null;
    const buf = Buffer.alloc(len);
    fh = await fs.promises.open(filePath, 'r');
    await fh.read(buf, 0, len, 0);
    await fh.close(); fh = null;
    try { return await fileType.fromBuffer(buf); } catch { return null; }
  } catch {
    return null;
  } finally {
    if (fh != null) try { await fh.close(); } catch {}
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
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '文件超过服务器配置的大小上限' });
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

// P1-03：直传路径磁盘阈值 + 单用户并发上限（与分片路径 chunk.js 同口径）。
// 直传 multer diskStorage 边收边落盘，无此守卫可被并行大文件流式耗尽磁盘。
// 内存 Map 计数：请求进入 +1，响应完成/中断 -1（res close/finish 均触发）。
const activeDirectUploads = new Map(); // userId -> 进行中的直传数
function makeUploadGuard(dest) {
  return (req, res, next) => {
    // 磁盘阈值：低于 MIN_DISK_FREE_BYTES 拒绝新上传（探测失败放行，不误伤）
    try {
      if (typeof fs.statfsSync === 'function') {
        const s = fs.statfsSync(dest);
        const free = s.bavail * s.bsize;
        if (free < MIN_DISK_FREE_BYTES) {
          return res.status(503).json({ error: '服务器磁盘空间不足，请稍后再试' });
        }
      }
    } catch { /* 无法探测时放行 */ }

    // 并发上限：同用户同时进行中的直传请求数
    const uid = req.user?.id || 'anon';
    const active = activeDirectUploads.get(uid) || 0;
    if (active >= MAX_CONCURRENT_UPLOADS) {
      return res.status(429).json({ error: `同时进行中的上传过多（上限 ${MAX_CONCURRENT_UPLOADS}），请先完成或等待清理` });
    }
    activeDirectUploads.set(uid, active + 1);
    // 只监听 close 释放（finish 之后必触发 close），避免 finish+close 双触发导致计数漂移
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const cur = activeDirectUploads.get(uid) || 1;
      if (cur <= 1) activeDirectUploads.delete(uid);
      else activeDirectUploads.set(uid, cur - 1);
    };
    res.on('close', release);
    next();
  };
}

// 会被剥离 EXIF 的图片 MIME。不含 GIF——GIF 是多帧动画，sharp 重编码有丢帧/体积暴涨风险，
// 且手机相机基本不会往 GIF 里写 GPS；jpeg/png/webp 才是头像/聊天照片/朋友圈图片的主力格式，
// 也是相机 EXIF/GPS 最常见的载体（见 AUDIT.md 十节"上传文件校验"🟡）。
const EXIF_STRIP_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * 剥离图片文件的 EXIF/GPS 元数据，原地重写，不改变可见画面内容。
 * .rotate() 不带参数：先按 EXIF Orientation 把像素摆正（否则很多手机竖拍的照片是靠这个
 * 元数据字段才显示方向正确的，直接清掉元数据不做这一步画面会转向），再原样编码回同一格式——
 * sharp 默认输出不写回任何元数据（除非显式调用 withMetadata()），等价于"保留画面、清空元数据"。
 * fail-open：这是隐私加固而非安全门禁，个别图片重编码失败不应该挡住用户正常上传，
 * 失败时记警告、原图原样保留。
 */
async function stripImageMetadata(filePath, mimetype) {
  if (!EXIF_STRIP_MIMES.has(mimetype)) return;
  try {
    const buf = await sharp(filePath).rotate().toBuffer();
    await fs.promises.writeFile(filePath, buf);
  } catch (err) {
    console.warn('[upload] EXIF 剥离失败，保留原图:', err.message);
  }
}

// 会被生成缩略图的图片 MIME，与 EXIF_STRIP_MIMES 同口径（同样的原因跳过 GIF：
// 多帧动画，sharp 缩放会丢帧/体积暴涨）。
const THUMBNAIL_MIMES = EXIF_STRIP_MIMES;

// 与 THUMBNAIL_MIMES 同口径的扩展名集合：云直传路径（credential）服务器不经手字节、
// 无法做魔数检测，只能按扩展名判断要不要给客户端多发一个缩略图预签名 URL。
const THUMBNAIL_EXTS = new Set(['jpg', 'jpeg', 'jpe', 'png', 'webp']);

/**
 * 原图旁生成一份 WebP 缩略图，命名约定：<dir>/<uuid>_thumb.webp（原扩展名去掉，
 * 换成 _thumb.webp）。前端按同一约定从原图 URL 纯字符串推导缩略图 URL，
 * 请求失败（旧图无缩略图/非图片类型）时 onError 回退原图——因此这里不需要、
 * 也不该往数据库/消息负载里加任何新字段，是纯 best-effort 的旁路产物。
 * fail-open：与 stripImageMetadata 同一哲学，缩略图生成失败绝不能挡住上传本身。
 */
async function generateThumbnail(filePath, mimetype, maxDim) {
  if (!THUMBNAIL_MIMES.has(mimetype)) return;
  try {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const thumbPath = path.join(dir, `${base}_thumb.webp`);
    await sharp(filePath)
      .rotate() // 与 stripImageMetadata 一致：缩放前先按 EXIF Orientation 摆正像素
      .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(thumbPath);
  } catch (err) {
    console.warn('[upload] 缩略图生成失败，跳过（不影响原图）:', err.message);
  }
}

// 图片元数据剥离 + 缩略图生成中间件：接在魔数校验之后，此时 file.mimetype 已是真实检测出的类型。
// maxDim：缩略图长边上限，聊天图片（makeChatUploader）显示尺寸更大，用 480；
// 头像/朋友圈/群头像等（makeImageUploader）用默认 400。
function makeExifStripMiddleware(maxDim = 400) {
  return async (req, res, next) => {
    const files = req.files || (req.file ? [req.file] : []);
    for (const file of files) {
      await stripImageMetadata(file.path, file.mimetype);
      await generateThumbnail(file.path, file.mimetype, maxDim);
    }
    next();
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
  // P1-03：直传路径与分片路径同口径 —— 磁盘阈值 + 单用户并发上限，
  // 否则攻击者可绕过 upload-init 的分片限制走直传耗尽磁盘（审计 BACKEND-A005）。
  // 聊天图片显示尺寸比头像/朋友圈大，缩略图 maxDim 用 480（见 makeExifStripMiddleware 注释）。
  return [makeUploadGuard(dest), multerMw, makeChatMagicMiddleware(), makeExifStripMiddleware(480)];
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
  return [wrapUpload(middleware), makeMagicBytesMiddleware(ALLOWED_IMAGE_MIMES), makeExifStripMiddleware()];
}

// 浏览器会内联渲染/执行的危险 MIME（html/xml/svg/js）。云直传对象的 Content-Type 由客户端
// 指定且不经服务器魔数校验，若带此类类型会在 CDN 域形成存储型 XSS——受害者「查看原图/下载」经
// <a href>/window.open 导航到该对象 URL 即触发。本地 /uploads 由 app.js nosniff+非图音视频附件
// 下发兜底，云存储 CDN 不经该中间件，故预签名前须在此把关拒绝。
function isBrowserRenderableType(contentType) {
  if (typeof contentType !== 'string') return false;
  const ct = contentType.toLowerCase().split(';')[0].trim(); // 去掉 charset 等参数
  // 结构化 XML 类型(svg+xml/xhtml+xml 等)可内联渲染并执行脚本/外部实体。
  // 注意：不能用 /xml/ 宽匹配——docx/xlsx/pptx 的 application/vnd.openxmlformats-... 含 "xml" 子串却安全。
  if (ct.endsWith('+xml')) return true;
  return DANGEROUS_RENDER_MIMES.has(ct);
}

module.exports = {
  ALLOWED_CHAT_EXTS, ALLOWED_IMAGE_MIMES, MIME_TO_EXT, BLOCKED_EXTENSIONS,
  MAX_UPLOAD_BYTES, MAX_CONCURRENT_UPLOADS, MIN_DISK_FREE_BYTES,
  sanitizeFilename, decodeMultipartName, safeExt, makeChatUploader, makeImageUploader, makeUploadGuard,
  verifyMagicBytes, verifyChatFile, isBrowserRenderableType, stripImageMetadata,
  generateThumbnail, THUMBNAIL_MIMES, THUMBNAIL_EXTS,
};
