'use strict';
const { asyncHandler, badRequest } = require('../../utils/http');
const svc = require('./moments.service');

const io = req => req.app.get('io');

exports.create        = asyncHandler(async (req, res) => res.json(svc.createMoment(io(req), req.user.id, req.body)));
exports.timeline      = asyncHandler(async (req, res) => res.json(svc.timeline(req.user.id, req.query)));
exports.userMoments   = asyncHandler(async (req, res) => res.json(svc.userMoments(req.user.id, req.params.userId)));
exports.detail        = asyncHandler(async (req, res) => res.json(svc.getMoment(req.user.id, req.params.id)));
exports.remove        = asyncHandler(async (req, res) => res.json(svc.deleteMoment(req.user.id, req.params.id)));
exports.like          = asyncHandler(async (req, res) => res.json(svc.toggleLike(io(req), req.user.id, req.params.id)));
exports.comment       = asyncHandler(async (req, res) => res.json(svc.addComment(io(req), req.user.id, req.params.id, req.body)));
exports.deleteComment = asyncHandler(async (req, res) => res.json(svc.deleteComment(req.user.id, req.params.commentId)));

exports.uploadImages = asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw badRequest('请选择图片');
  const urls = files.map(f => `/uploads/moments/${f.filename}`);
  res.json({ urls });
});
