'use strict';
const path = require('path');
const config = require('../../config');
const { asyncHandler, badRequest } = require('../../utils/http');
const { makeChatUploader, sanitizeFilename } = require('../../utils/upload');
const { isMember } = require('./shared');
const { pushNewMessage } = require('../../utils/push');
const svc = require('./messages.service');

const io = req => req.app.get('io');
const chatUploader = makeChatUploader(path.join(config.uploadsRoot, 'files'));

exports.history = asyncHandler(async (req, res) =>
  res.json(svc.history(req.params.conversationId, req.user.id, req.query)));

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
  res.json({ success: true, sent: await svc.forward(io(req), req.user.id, req.body) }));

exports.batchDelete = asyncHandler(async (req, res) =>
  res.json({ success: true, deleted: await svc.batchDelete(io(req), req.user.id, req.body) }));

exports.remove = asyncHandler(async (req, res) => {
  await svc.remove(io(req), req.user.id, req.params.msgId, req.body.forEveryone, req.body.vanish);
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
  const { conversationId } = req.params;
  const mime = req.file.mimetype;
  const type = mime.startsWith('image/') ? 'image'
             : mime.startsWith('audio/') ? 'voice'
             : mime.startsWith('video/') ? 'video' : 'file';
  const safeOriginalName = sanitizeFilename(req.file.originalname);
  const url = `/uploads/files/${req.file.filename}`;

  const msg = await svc.saveUploadedFile(io(req), conversationId, req.user.id, {
    type, content: safeOriginalName, fileUrl: url, reply_to_id: req.body.reply_to_id,
  });

  pushNewMessage({
    conversationId, senderId: req.user.id, senderName: msg.senderName,
    content: safeOriginalName, type, timestamp: msg.created_at,
    onlineUserIds: req.app.get('onlineUsers') || new Set(),
  }).catch(() => {});

  res.json(msg);
});
