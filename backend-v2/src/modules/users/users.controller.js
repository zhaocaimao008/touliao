'use strict';
const QRCode = require('qrcode');
const { asyncHandler, badRequest } = require('../../utils/http');
const { registerFile } = require('../../utils/fileRegistry');
const svc = require('./users.service');
const { readDb } = require('../../db/connection');

// 改昵称/头像后实时通知：好友、同群成员、私聊对象与本人其他设备（原先要等对方刷新列表才看到）。
// io.to(多个房间) 会按 socket 去重，同时在多个房间里的人只收到一次。
function broadcastProfile(req, userId) {
  const io = req.app.get('io');
  if (!io) return;
  const u = readDb.prepare('SELECT id, username, avatar FROM users WHERE id=?').get(userId);
  if (!u) return;
  const rooms = new Set([`user_${userId}`]);
  readDb.prepare('SELECT user_id FROM contacts WHERE contact_id=?').all(userId).forEach(r => rooms.add(`user_${r.user_id}`));
  readDb.prepare('SELECT conversation_id FROM conversation_members WHERE user_id=?').all(userId).forEach(r => rooms.add(r.conversation_id));
  io.to([...rooms]).emit('user_profile_updated', { userId, username: u.username, avatar: u.avatar || '' });
}

exports.qrcode = asyncHandler(async (req, res) => {
  const png = await QRCode.toBuffer(svc.qrPayload(req.user.id), {
    type: 'png', margin: 1, width: 280, errorCorrectionLevel: 'M',
  });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(png);
});

exports.getMyInvite    = asyncHandler(async (req, res) => res.json(svc.getMyInvite(req.user.id)));
exports.scanQrUser     = asyncHandler(async (req, res) => res.json(svc.scanQrUser(req.user.id, req.body.payload)));
exports.getSettings    = asyncHandler(async (req, res) => res.json(svc.getSettings(req.user.id)));
exports.updateSettings = asyncHandler(async (req, res) => res.json(svc.updateSettings(req.user.id, req.body)));
exports.search         = asyncHandler(async (req, res) => res.json(svc.search(req.user.id, req.query.q)));

exports.updateProfile  = asyncHandler(async (req, res) => {
  const updated = await svc.updateProfile(req.user.id, req.body);
  if (req.body?.username) broadcastProfile(req, req.user.id);
  res.json(updated);
});

exports.uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('请选择图片');
  const url = `/uploads/avatars/${req.file.filename}`;
  registerFile({ path: url, ownerId: req.user.id, kind: 'avatars' });
  await svc.setAvatar(req.user.id, url);
  broadcastProfile(req, req.user.id);
  res.json({ avatar: url });
});

exports.uploadCover = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('请选择图片');
  const url = `/uploads/avatars/${req.file.filename}`;
  registerFile({ path: url, ownerId: req.user.id, kind: 'avatars' });
  await svc.setCover(req.user.id, url);
  res.json({ cover_photo: url });
});

exports.getUserDetail  = asyncHandler(async (req, res) => res.json(await svc.getUserDetail(req.user.id, req.params.id)));
exports.getCollections    = asyncHandler(async (req, res) => res.json(svc.getCollections(req.user.id, req.query)));
exports.addCollection     = asyncHandler(async (req, res) => res.json(svc.addCollection(req.user.id, req.body)));
exports.removeCollection  = asyncHandler(async (req, res) => res.json(svc.removeCollection(req.user.id, req.params.id)));
exports.searchCollections = asyncHandler(async (req, res) => res.json(svc.searchCollections(req.user.id, req.query)));
exports.getCollection     = asyncHandler(async (req, res) => res.json(svc.getCollection(req.user.id, req.params.id)));
exports.getCallLogs = asyncHandler(async (req, res) => res.json(svc.getCallLogs(req.user.id, req.query.limit)));

// 换绑手机号：PUT /api/users/me/phone
exports.changePhone = asyncHandler(async (req, res) =>
  res.json(await svc.changePhone(req.user.id, req.body)));
