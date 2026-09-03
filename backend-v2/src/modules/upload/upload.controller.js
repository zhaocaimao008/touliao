'use strict';
const { v4: uuidv4 } = require('uuid');
const { asyncHandler, badRequest, forbidden } = require('../../utils/http');
const { isConfigured, getPresignedPutUrl } = require('../../utils/cloudStorage');
const { registerFile } = require('../../utils/fileRegistry');
const path = require('path');
const { safeExt, ALLOWED_CHAT_EXTS, isBrowserRenderableType, MAX_UPLOAD_BYTES, THUMBNAIL_EXTS } = require('../../utils/upload');
const { isMember } = require('../messages/shared');

/**
 * POST /api/upload/credential
 * 客户端上传前换取预签名 PUT URL，文件直传云存储，绝不经过本服务器。
 */
exports.credential = asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: '云存储未配置，请在服务器 .env 中设置 CLOUD_PROVIDER 及对应密钥' });
  }
  const { filename, contentType, conversationId, fileSize } = req.body;
  if (!filename || !contentType || !conversationId) {
    throw badRequest('参数缺失: filename, contentType, conversationId');
  }
  // fileSize 可选（部分客户端不传）；传了才校验：须为正整数字节，且不超过配置上限(与直传/分片一致)。
  if (fileSize !== undefined && fileSize !== null && fileSize !== '') {
    const size = Number(fileSize);
    if (!Number.isInteger(size) || size < 1) {
      throw badRequest('fileSize 无效（需为正整数字节）');
    }
    const MAX = MAX_UPLOAD_BYTES;
    if (size > MAX) {
      throw badRequest(`文件超过上限 ${Math.floor(MAX / 1024 / 1024)}MB`);
    }
  }
  if (!isMember(conversationId, req.user.id)) throw forbidden('无权上传至该会话');
  // 仅放行常见格式（云直传不经本服务器、无法做魔数校验，故按扩展名把关）。
  const rawExt = path.extname(filename || '').toLowerCase().replace(/^\./, '');
  if (!ALLOWED_CHAT_EXTS.has(rawExt)) {
    throw badRequest(`不支持的文件格式（${rawExt ? '.' + rawExt : '无扩展名'}）；仅支持常见图片/音视频/文档/压缩包`);
  }
  // 云直传对象的 Content-Type 由客户端指定、写入预签名后即固定为该对象响应头；扩展名过白名单
  // (.png 等)但 contentType 可伪成 text/html、image/svg+xml，对象在 CDN 域被浏览器当 HTML/JS 渲染
  // → 存储型 XSS。正常客户端发的 image/*、video/*、application/pdf 等不受影响，仅拒渲染型。
  if (isBrowserRenderableType(contentType)) {
    throw badRequest('不支持的内容类型');
  }

  const ext = safeExt(filename, contentType);
  // R2 key 与本站访问路径一一对应（去前导斜杠），保证 /uploads 下载侧可直接映射；
  // file_url 保持本站路径格式（前端零改动），下载时经 file_registry 权限校验后 302 到短时 presigned GET。
  const uuid = uuidv4();
  const fileName = `${uuid}${ext}`;
  const key = `uploads/files/${fileName}`;
  const publicUrl = `/uploads/files/${fileName}`;
  try {
    const { uploadUrl } = await getPresignedPutUrl(key, contentType);
    // 上传即登记归属（owner + conversation），供下载侧 file_registry 权限校验（P1-02 体系）。
    // 生成 URL 成功后才登记，避免失败时留下无对象残留。
    registerFile({ path: publicUrl, ownerId: req.user.id, conversationId, kind: 'files' });

    const resp = { uploadUrl, publicUrl, key, expiresIn: 600 };
    // 云直传服务器不经手字节，无法像本地路径那样自己生成缩略图；命名约定与本地一致
    // （同一 uuid + _thumb.webp，见 utils/upload.js generateThumbnail），客户端自行用
    // Canvas 生成缩略图后拿这个凭证再传一次。非图片扩展名不发，前端据此判断要不要传缩略图。
    if (THUMBNAIL_EXTS.has(rawExt)) {
      try {
        const thumbKey = `uploads/files/${uuid}_thumb.webp`;
        const { uploadUrl: thumbUploadUrl } = await getPresignedPutUrl(thumbKey, 'image/webp');
        resp.thumbUploadUrl = thumbUploadUrl;
      } catch (e) {
        // 缩略图凭证是锦上添花，生成失败不该搭上整个上传请求——原图凭证已经拿到手了。
        console.warn('[upload/credential] 缩略图预签名 URL 生成失败，跳过:', e.message);
      }
    }
    res.json(resp);
  } catch (e) {
    console.error('[upload/credential] 生成预签名 URL 失败:', e.message);
    res.status(500).json({ error: '生成上传凭证失败，请稍后重试' });
  }
});
