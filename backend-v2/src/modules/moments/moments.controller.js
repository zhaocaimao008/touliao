'use strict';
const { asyncHandler, badRequest } = require('../../utils/http');
const svc = require('./moments.service');

const io = req => req.app.get('io');

exports.create        = asyncHandler(async (req, res) => res.json(svc.createMoment(io(req), req.user.id, req.body)));
exports.timeline      = asyncHandler(async (req, res) => res.json(svc.timeline(req.user.id, req.query)));
exports.userMoments   = asyncHandler(async (req, res) => res.json(svc.userMoments(req.user.id, req.params.userId, req.query)));
exports.detail        = asyncHandler(async (req, res) => res.json(svc.getMoment(req.user.id, req.params.id)));
exports.remove        = asyncHandler(async (req, res) => res.json(svc.deleteMoment(req.user.id, req.params.id)));
exports.like          = asyncHandler(async (req, res) => res.json(svc.toggleLike(io(req), req.user.id, req.params.id)));
exports.comment       = asyncHandler(async (req, res) => res.json(svc.addComment(io(req), req.user.id, req.params.id, req.body)));
exports.deleteComment = asyncHandler(async (req, res) => res.json(svc.deleteComment(req.user.id, req.params.commentId)));
exports.likes         = asyncHandler(async (req, res) => res.json(svc.listLikes(req.user.id, req.params.id, req.query)));
exports.comments      = asyncHandler(async (req, res) => res.json(svc.listComments(req.user.id, req.params.id, req.query)));
exports.report        = asyncHandler(async (req, res) => res.json(svc.reportMoment(req.user.id, req.params.id, req.body)));

// ── 互动通知 feed（MO2）──────────────────────────────────────────
exports.notifications     = asyncHandler(async (req, res) => res.json(svc.listNotifications(req.user.id, req.query)));
exports.notifUnreadCount  = asyncHandler(async (req, res) => res.json({ count: svc.unreadNotificationCount(req.user.id) }));
exports.notifMarkRead     = asyncHandler(async (req, res) => res.json(svc.markNotificationsRead(req.user.id)));

exports.uploadImages = asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw badRequest('请选择图片');
  const urls = files.map(f => `/uploads/moments/${f.filename}`);
  res.json({ urls });
});
