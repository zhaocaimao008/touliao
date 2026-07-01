'use strict';
const { v4: uuidv4 } = require('uuid');
const { asyncHandler, badRequest, forbidden } = require('../../utils/http');
const { isConfigured, getPresignedPutUrl } = require('../../utils/cloudStorage');
const { ALLOWED_CHAT_MIMES, MIME_TO_EXT } = require('../../utils/upload');
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
  const size = Number(fileSize);
  if (!Number.isInteger(size) || size < 1 || size > 50 * 1024 * 1024) {
    throw badRequest('fileSize 无效（1 字节 ~ 50 MB）');
  }
  if (!isMember(conversationId, req.user.id)) throw forbidden('无权上传至该会话');
  if (!ALLOWED_CHAT_MIMES.has(contentType)) throw badRequest(`不支持的文件类型: ${contentType}`);

  const ext = MIME_TO_EXT[contentType] || '.bin';
  const key = `chat/${conversationId}/${uuidv4()}${ext}`;
  try {
    const { uploadUrl, publicUrl } = await getPresignedPutUrl(key, contentType);
    res.json({ uploadUrl, publicUrl, key, expiresIn: 600 });
  } catch (e) {
    console.error('[upload/credential] 生成预签名 URL 失败:', e.message);
    res.status(500).json({ error: '生成上传凭证失败，请稍后重试' });
  }
});
