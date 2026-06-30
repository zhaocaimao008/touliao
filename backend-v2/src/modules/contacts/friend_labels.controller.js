'use strict';
const { asyncHandler } = require('../../utils/http');
const svc = require('./friend_labels.service');

exports.list   = asyncHandler(async (req, res) => res.json(svc.listLabels(req.user.id)));
exports.create = asyncHandler(async (req, res) => res.json(svc.createLabel(req.user.id, req.body)));
exports.update = asyncHandler(async (req, res) => res.json(svc.updateLabel(req.user.id, req.params.id, req.body)));
exports.remove = asyncHandler(async (req, res) => { svc.deleteLabel(req.user.id, req.params.id); res.json({ success: true }); });
exports.addMember    = asyncHandler(async (req, res) => res.json(svc.addMember(req.user.id, req.params.id, req.body.friendId)));
exports.removeMember = asyncHandler(async (req, res) => { svc.removeMember(req.user.id, req.params.id, req.params.friendId); res.json({ success: true }); });
