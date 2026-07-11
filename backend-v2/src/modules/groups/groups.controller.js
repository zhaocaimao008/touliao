'use strict';
const path = require('path');
const config = require('../../config');
const { asyncHandler, badRequest } = require('../../utils/http');
const { makeImageUploader } = require('../../utils/upload');
const svc = require('./groups.service');

const io = req => req.app.get('io');
const groupAvatarUploader = makeImageUploader(path.join(config.uploadsRoot, 'avatars'), 'avatar', 1, 5 * 1024 * 1024);

exports.setNickname = asyncHandler(async (req, res) =>
  res.json({ success: true, nickname: svc.setNickname(io(req), req.params.convId, req.user.id, req.body.nickname) }));

exports.createInviteLink = asyncHandler(async (req, res) =>
  res.json(svc.createInviteLink(req.params.convId, req.user.id)));

exports.qrCode = asyncHandler(async (req, res) =>
  res.json(await svc.getQrCode(req.params.convId, req.user.id)));

exports.join = asyncHandler(async (req, res) =>
  res.json(svc.joinByToken(io(req), req.user.id, req.params.token)));

exports.updateInfo = asyncHandler(async (req, res) =>
  res.json(svc.updateInfo(io(req), req.params.convId, req.user.id, req.body)));

exports.avatarMiddlewares = groupAvatarUploader;
exports.setAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('请选择图片');
  const url = `/uploads/avatars/${req.file.filename}`;
  res.json({ avatar: svc.setAvatar(io(req), req.params.convId, req.user.id, url) });
});

exports.invite = asyncHandler(async (req, res) => {
  const r = svc.invite(io(req), req.params.convId, req.user.id, req.body.userIds);
  // 兼容旧前端：added 保持数值；同时附带 blocked（因隐私设置未能拉入的人数）
  res.json({ success: true, added: r.added, blocked: r.blocked });
});

exports.kick = asyncHandler(async (req, res) => {
  svc.kick(io(req), req.params.convId, req.user.id, req.params.uid);
  res.json({ success: true });
});

exports.leave = asyncHandler(async (req, res) => {
  svc.leave(io(req), req.params.convId, req.user.id);
  res.json({ success: true });
});

exports.dissolve = asyncHandler(async (req, res) => {
  svc.dissolve(io(req), req.params.convId, req.user.id);
  res.json({ success: true });
});

exports.info   = asyncHandler(async (req, res) => res.json(svc.info(req.params.convId, req.user.id)));
exports.manage = asyncHandler(async (req, res) => res.json(svc.manage(io(req), req.params.convId, req.user.id, req.body)));

exports.setRole = asyncHandler(async (req, res) => {
  svc.setRole(io(req), req.params.convId, req.user.id, req.params.uid, req.body.role);
  res.json({ success: true, role: req.body.role });
});

exports.transferOwner = asyncHandler(async (req, res) => {
  svc.transferOwner(io(req), req.params.convId, req.user.id, req.body.userId);
  res.json({ success: true });
});

exports.pinMessage   = asyncHandler(async (req, res) => { svc.pinMessage(io(req), req.params.convId, req.user.id, req.body.msgId); res.json({ success: true }); });
exports.unpinMessage = asyncHandler(async (req, res) => { svc.unpinMessage(io(req), req.params.convId, req.user.id, req.params.msgId); res.json({ success: true }); });
exports.listPinned   = asyncHandler(async (req, res) => res.json(svc.listPinned(req.params.convId, req.user.id)));
