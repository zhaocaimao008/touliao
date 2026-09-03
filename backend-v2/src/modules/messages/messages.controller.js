'use strict';
const path = require('path');
const config = require('../../config');
const { asyncHandler, badRequest } = require('../../utils/http');
const { makeChatUploader, makeImageUploader, makeUploadGuard, sanitizeFilename, decodeMultipartName, thumbUrlIfExists } = require('../../utils/upload');
const { isMember } = require('./shared');
const { pushNewMessage } = require('../../utils/push');
const { registerFile } = require('../../utils/fileRegistry');
const svc = require('./messages.service');
const syncSvc = require('./sync.service');

const io = req => req.app.get('io');
const chatUploader = makeChatUploader(path.join(config.uploadsRoot, 'files'));
// 群/私聊背景图专用上传（仅存文件，不发消息）
// P1-03：背景图是图片，切回 5MB 图片上传器（严格 MIME + 魔数 + 5MB 上限），
// 不再复用 200MB 聊天上传器——避免经 background-upload 无限流直传耗尽磁盘。
const bgUploader = makeImageUploader(path.join(config.uploadsRoot, 'bg'), 'file', 1, 5 * 1024 * 1024);
// P1-03 M2：background-upload 前置磁盘阈值 + 并发守卫（与直传同一策略），
// 否则 5MB 图片可被并行流式写盘压到磁盘 0，绕开 500MB 阈值拦截。
const bgUploadGuard = makeUploadGuard(path.join(config.uploadsRoot, 'bg'));

exports.history = asyncHandler(async (req, res) =>
  res.json(svc.history(req.params.conversationId, req.user.id, req.query)));

exports.sync = asyncHandler(async (req, res) =>
  res.json(syncSvc.syncConversation(req.params.conversationId, req.user.id, req.query)));

exports.aroundMessage = asyncHandler(async (req, res) => {
  const result = svc.aroundMessage(req.params.convId, req.params.msgId, req.user.id);
  if (!result) return res.status(404).json({ error: '消息不存在' });
  res.json(result);
});

exports.missed = asyncHandler(async (req, res) =>
  res.json(svc.missed(io(req), req.user.id, parseInt(req.query.after) || 0)));

exports.send = asyncHandler(async (req, res) =>
  res.json(await svc.send(io(req), req.params.conversationId, req.user.id, req.body)));

exports.forward = asyncHandler(async (req, res) =>
  res.json({ success: true, ...await svc.forward(io(req), req.user.id, req.body) }));

exports.batchDelete = asyncHandler(async (req, res) =>
  res.json({ success: true, deleted: await svc.batchDelete(io(req), req.user.id, req.body) }));

exports.remove = asyncHandler(async (req, res) => {
  await svc.remove(io(req), req.user.id, req.params.msgId, req.body.forEveryone, req.body.vanish, req.body.forMe);
  res.json({ success: true });
});

exports.react = asyncHandler(async (req, res) =>
  res.json({ reactions: await svc.react(io(req), req.user.id, req.params.msgId, req.body.emoji) }));

exports.edit = asyncHandler(async (req, res) =>
  res.json({ success: true, content: await svc.edit(io(req), req.user.id, req.params.msgId, req.body.content) }));

exports.collect = asyncHandler(async (req, res) => {
  const row = await svc.collect(req.user.id, req.params.msgId);
  res.json({ success: true, ...row });
});

exports.searchGlobal = asyncHandler(async (req, res) => res.json(await svc.searchGlobal(req.user.id, req.query)));
exports.searchInConv = asyncHandler(async (req, res) =>
  res.json(await svc.searchInConversation(req.params.convId, req.user.id, req.query.q)));

// 聊天记录导出：GET /api/messages/conversation/:convId/export
exports.exportConversation = asyncHandler(async (req, res) => {
  const text = svc.exportConversation(req.params.convId, req.user.id);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="chat-${req.params.convId}.txt"`);
  res.send(text);
});

// 聊天文件聚合：GET /api/messages/conversation/:convId/files
exports.conversationFiles = asyncHandler(async (req, res) =>
  res.json(svc.getConversationFiles(req.params.convId, req.user.id, req.query)));

// @我消息聚合：GET /api/messages/mentions/me
exports.myMentions = asyncHandler(async (req, res) =>
  res.json(svc.getMentions(req.user.id, req.query)));

// ── 语音转文字：POST /api/messages/:msgId/transcribe ────────────
// 校验语音消息 + 会话成员权限 → 调 ASR 服务真实转写 → 缓存并返回。
// ASR 不可用（AsrUnavailableError）返回 503，前端提示服务暂不可用，绝不返回假数据。
exports.transcribe = asyncHandler(async (req, res) => {
  try {
    const result = await svc.transcribe(req.user.id, req.params.msgId);
    res.json(result);
  } catch (e) {
    if (e && e.asrUnavailable) {
      return res.status(503).json({ error: '转写服务暂不可用，请稍后重试' });
    }
    throw e;
  }
});

// ── 文件上传：权限门控 → multer+魔数 → 入库广播+推送 ─────────────
exports.uploadGuard = (req, res, next) => {
  const convId = req.params.conversationId;
  const uid = req.user.id;
  if (!isMember(convId, uid)) return res.status(403).json({ error: '无权发送' });
  const { db } = require('../../db/connection');
  const conv = db.prepare('SELECT mute_all FROM conversations WHERE id=?').get(convId);
  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, uid);
  if (conv?.mute_all && member?.role === 'member') return res.status(403).json({ error: '全员禁言中，您没有发言权限' });
  next();
};
exports.uploadMiddlewares = chatUploader;
exports.uploadHandle = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('请选择文件');
  // 2026-08-29 修复：iOS视频上传曾因客户端流式拼装bug产生0字节附件——数据库正常建了消息记录，
  // 但物理文件是空的，Android端播放器打开后黑屏卡在00:00/00:00。客户端bug已修，这里再加一道
  // 服务端兜底：拒绝空文件，不管来自哪个端/哪次回归，都不会再让0字节附件进库生成一条永久打不开的消息。
  if (req.file.size === 0) {
    require('fs').unlink(req.file.path, () => {});
    throw badRequest('文件为空，请重新选择');
  }
  const { conversationId } = req.params;
  const mime = req.file.mimetype;
  const type = mime.startsWith('image/') ? 'image'
             : mime.startsWith('audio/') ? 'voice'
             : mime.startsWith('video/') ? 'video' : 'file';
  const safeOriginalName = sanitizeFilename(decodeMultipartName(req.file.originalname));
  const url = `/uploads/files/${req.file.filename}`;
  registerFile({ path: url, ownerId: req.user.id, conversationId, kind: 'files' });
  // 图片：generateThumbnail 已在 uploadMiddlewares 里跑过（makeChatUploader 内置），
  // 若确实生成了缩略图，一并登记——否则 /uploads 访问鉴权会把缩略图当"未登记"404。
  if (type === 'image') {
    const thumbUrl = thumbUrlIfExists(req.file.path, url);
    if (thumbUrl) registerFile({ path: thumbUrl, ownerId: req.user.id, conversationId, kind: 'files' });
  }

  // 2026-08-29 好友申请/视频语音修复配套：可选 duration 字段(秒，客户端传整数字符串)。
  // 语音/视频消息此前完全没有时长——聊天气泡只能显示固定"🎙 语音"文字而非真实时长。
  // 不信任客户端声称的任意大数：限制在合理范围(0~24h)内，超出视为无效直接丢弃(仍能发送，只是没时长)。
  let duration = parseInt(req.body.duration, 10);
  if (!Number.isFinite(duration) || duration < 0 || duration > 86400) duration = 0;

  const msg = await svc.saveUploadedFile(io(req), conversationId, req.user.id, {
    type, content: safeOriginalName, fileUrl: url, reply_to_id: req.body.reply_to_id,
    fileMime: mime, fileSize: req.file.size, duration,
  });

  pushNewMessage({
    conversationId, senderId: req.user.id, senderName: msg.senderName,
    content: safeOriginalName, type, timestamp: msg.created_at,
    onlineUserIds: req.app.get('onlineUsers') || new Set(),
  }).catch(() => {});

  res.json(msg);
});

// ── 聊天背景图本地上传（不发消息，仅存文件返回 URL）─────────────
exports.bgUploadMiddleware = [bgUploadGuard, ...bgUploader];
exports.backgroundUpload = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('请选择图片');
  if (!isMember(req.params.convId, req.user.id)) return res.status(403).json({ error: '无权操作' });
  const mime = req.file.mimetype;
  if (!mime.startsWith('image/')) {
    require('fs').unlink(req.file.path, () => {});
    throw badRequest('仅支持图片格式');
  }
  const url = `/uploads/bg/${req.file.filename}`;
  registerFile({ path: url, ownerId: req.user.id, conversationId: req.params.convId, kind: 'bg' });
  res.json({ url });
});

// ── 聊天背景图本地上传（不发消息，仅存文件返回 URL）─────────────
