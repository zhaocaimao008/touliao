'use strict';
const QRCode = require('qrcode');
const { asyncHandler, badRequest } = require('../../utils/http');
const svc = require('./users.service');

exports.qrcode = asyncHandler(async (req, res) => {
  const png = await QRCode.toBuffer(svc.qrPayload(req.user.id), {
    type: 'png', margin: 1, width: 280, errorCorrectionLevel: 'M',
  });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(png);
});

exports.getSettings    = asyncHandler(async (req, res) => res.json(svc.getSettings(req.user.id)));
exports.updateSettings = asyncHandler(async (req, res) => res.json(svc.updateSettings(req.user.id, req.body)));
exports.search         = asyncHandler(async (req, res) => res.json(svc.search(req.user.id, req.query.q)));

exports.updateProfile  = asyncHandler(async (req, res) => res.json(await svc.updateProfile(req.user.id, req.body)));

exports.uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('请选择图片');
  const url = `/uploads/avatars/${req.file.filename}`;
  await svc.setAvatar(req.user.id, url);
  res.json({ avatar: url });
});

exports.uploadCover = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('请选择图片');
  const url = `/uploads/avatars/${req.file.filename}`;
  await svc.setCover(req.user.id, url);
  res.json({ cover_photo: url });
});

exports.getUserDetail  = asyncHandler(async (req, res) => res.json(await svc.getUserDetail(req.user.id, req.params.id)));
exports.getCollections    = asyncHandler(async (req, res) => res.json(svc.getCollections(req.user.id, req.query)));
exports.addCollection     = asyncHandler(async (req, res) => res.json(svc.addCollection(req.user.id, req.body)));
exports.removeCollection  = asyncHandler(async (req, res) => res.json(svc.removeCollection(req.user.id, req.params.id)));
exports.getCallLogs = asyncHandler(async (req, res) => res.json(svc.getCallLogs(req.user.id, req.query.limit)));
