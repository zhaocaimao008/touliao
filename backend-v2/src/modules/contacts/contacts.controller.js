'use strict';
const { asyncHandler } = require('../../utils/http');
const { invalidateSocial } = require('../../realtime/socialState');
const svc = require('./contacts.service');

const io = req => req.app.get('io');

exports.listContacts   = asyncHandler(async (req, res) => {
  // 关系/资料权限随时可撤销，禁止复用浏览器的旧响应。
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(svc.listContacts(req.user.id));
});
exports.deleteContact  = asyncHandler(async (req, res) => { svc.deleteContact(req.user.id, req.params.contactId); invalidateSocial(io(req), [req.user.id, req.params.contactId]); res.json({ success: true }); });
exports.setRemark      = asyncHandler(async (req, res) => { svc.setRemark(req.user.id, req.params.contactId, req.body.remark); invalidateSocial(io(req), [req.user.id], ['relationships', 'conversations']); res.json({ success: true }); });

exports.sendFriendRequest   = asyncHandler(async (req, res) => res.json(svc.sendFriendRequest(io(req), req.user.id, req.body)));
exports.listReceived        = asyncHandler(async (req, res) => res.json(svc.listReceivedRequests(req.user.id)));
exports.listSent            = asyncHandler(async (req, res) => res.json(svc.listSentRequests(req.user.id)));
exports.handleRequest       = asyncHandler(async (req, res) => { svc.handleRequest(io(req), req.user.id, req.params.id, req.body.action); res.json({ success: true }); });

exports.block       = asyncHandler(async (req, res) => { svc.block(req.user.id, req.params.targetId); invalidateSocial(io(req), [req.user.id, req.params.targetId]); res.json({ success: true, blocked: true }); });
exports.unblock     = asyncHandler(async (req, res) => { svc.unblock(req.user.id, req.params.targetId); invalidateSocial(io(req), [req.user.id, req.params.targetId]); res.json({ success: true, blocked: false }); });
exports.listBlocked = asyncHandler(async (req, res) => res.json(svc.listBlocked(req.user.id)));
