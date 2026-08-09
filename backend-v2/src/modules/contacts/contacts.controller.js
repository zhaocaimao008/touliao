'use strict';
const { asyncHandler } = require('../../utils/http');
const svc = require('./contacts.service');

const io = req => req.app.get('io');

exports.listContacts   = asyncHandler(async (req, res) => {
  // 联系人列表变化频率低(添加/删除好友才变)，短暂缓存 30s 避免重连风暴中重复请求
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  res.json(svc.listContacts(req.user.id));
});
exports.deleteContact  = asyncHandler(async (req, res) => { svc.deleteContact(req.user.id, req.params.contactId); res.json({ success: true }); });
exports.setRemark      = asyncHandler(async (req, res) => { svc.setRemark(req.user.id, req.params.contactId, req.body.remark); res.json({ success: true }); });

exports.sendFriendRequest   = asyncHandler(async (req, res) => res.json(svc.sendFriendRequest(io(req), req.user.id, req.body)));
exports.listReceived        = asyncHandler(async (req, res) => res.json(svc.listReceivedRequests(req.user.id)));
exports.listSent            = asyncHandler(async (req, res) => res.json(svc.listSentRequests(req.user.id)));
exports.handleRequest       = asyncHandler(async (req, res) => { svc.handleRequest(io(req), req.user.id, req.params.id, req.body.action); res.json({ success: true }); });

exports.block       = asyncHandler(async (req, res) => { svc.block(req.user.id, req.params.targetId); res.json({ success: true, blocked: true }); });
exports.unblock     = asyncHandler(async (req, res) => { svc.unblock(req.user.id, req.params.targetId); res.json({ success: true, blocked: false }); });
exports.listBlocked = asyncHandler(async (req, res) => res.json(svc.listBlocked(req.user.id)));
