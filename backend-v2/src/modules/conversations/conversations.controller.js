'use strict';
const { asyncHandler } = require('../../utils/http');
const { error: logError } = require('../../utils/logger');
const svc = require('./conversations.service');

const io = req => req.app.get('io');

exports.createPrivate = asyncHandler(async (req, res) => res.json(svc.getOrCreatePrivate(req.user.id, req.body.userId, { io: io(req) })));
exports.createPrivateBatch = asyncHandler(async (req, res) => {
  const { userIds } = req.body;
  if (!Array.isArray(userIds) || userIds.length === 0)
    return res.status(400).json({ error: '参数缺失' });
  if (userIds.length > 50)
    return res.status(400).json({ error: '单次最多50个好友' });
  const conversations = await svc.batchGetOrCreatePrivate(req.user.id, userIds, { io: io(req) });
  res.json({ conversations });
});
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
  // 标记已读是「最终一致」的非关键高频接口：失败时柔性返回而非 500，
  // 避免偶发错误干扰"打开会话"体验(前端本就 .catch 静默)。
  // 同时显式打印真实错误栈——此前偶发 500 走通用错误处理无栈可查。
  try {
    const r = await svc.markRead(io(req), req.user.id, req.params.convId, req.body.messageId);
    res.json({ success: true, ...r });
  } catch (err) {
    logError('[markRead] failed (soft-degraded)', err, {
      convId: req.params.convId,
      userId: req.user && req.user.id,
      messageId: req.body && req.body.messageId,
    });
    res.json({ success: false, readAt: 0, lastReadMessageId: null });
  }
});

exports.markUnread = asyncHandler(async (req, res) => {
  await svc.markUnread(req.user.id, req.params.convId);
  res.json({ success: true });
});

exports.setBurnAfter = asyncHandler(async (req, res) => {
  const r = await svc.setBurnAfter(req.user.id, req.params.convId, req.body.seconds);
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
