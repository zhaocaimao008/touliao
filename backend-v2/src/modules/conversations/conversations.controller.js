'use strict';
const { asyncHandler } = require('../../utils/http');
const svc = require('./conversations.service');

const io = req => req.app.get('io');

exports.createPrivate = asyncHandler(async (req, res) => res.json(svc.getOrCreatePrivate(req.user.id, req.body.userId)));
exports.fileHelper    = asyncHandler(async (req, res) => res.json(svc.getOrCreateFileHelper(req.user.id)));
exports.createGroup   = asyncHandler(async (req, res) => res.json(svc.createGroup(io(req), req.user.id, req.body)));
exports.list          = asyncHandler(async (req, res) => res.json(await svc.listConversations(req.user.id)));
exports.members       = asyncHandler(async (req, res) => res.json(svc.listMembers(req.params.conversationId, req.user.id)));
exports.unreadCounts  = asyncHandler(async (req, res) => res.json(svc.unreadCounts(req.user.id)));
exports.myGroups      = asyncHandler(async (req, res) => res.json(svc.myGroups(req.user.id)));

exports.pin  = asyncHandler(async (req, res) => { await svc.setPinned(req.user.id, req.params.convId, req.body.pinned); res.json({ success: true }); });
exports.mute = asyncHandler(async (req, res) => { await svc.setMuted(req.user.id, req.params.convId, req.body.muted); res.json({ success: true }); });
exports.background = asyncHandler(async (req, res) => { const r = await svc.setBackground(req.user.id, req.params.convId, req.body.background); res.json({ success: true, ...r }); });

exports.read = asyncHandler(async (req, res) => {
  const r = await svc.markRead(io(req), req.user.id, req.params.convId, req.body.messageId);
  res.json({ success: true, ...r });
});

exports.clearConversation = asyncHandler(async (req, res) => {
  const deleted = svc.clearConversation(io(req), req.user.id, req.params.convId);
  res.json({ success: true, deleted });
});

exports.clearAll = asyncHandler(async (req, res) => {
  const r = svc.clearAllConversations(io(req), req.user.id);
  res.json({ success: true, ...r });
});

exports.media = asyncHandler(async (req, res) => res.json(svc.media(req.user.id, req.query)));
