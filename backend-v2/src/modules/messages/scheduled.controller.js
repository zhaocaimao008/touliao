'use strict';
/**
 * 定时消息 HTTP 层：创建 / 取消 / 列表。
 * 与 messages.controller 一样，仅做参数透传 + asyncHandler 包装，逻辑在 service。
 */
const { asyncHandler } = require('../../utils/http');
const svc = require('./scheduled.service');

// POST /api/messages/schedule
exports.create = asyncHandler(async (req, res) =>
  res.json({ success: true, scheduled: svc.scheduleMessage(req.user.id, req.body) }));

// GET /api/messages/schedule（我的 pending 定时消息列表）
exports.list = asyncHandler(async (req, res) =>
  res.json(svc.listScheduledMessages(req.user.id, req.query.status)));

// DELETE /api/messages/schedule/:id
exports.cancel = asyncHandler(async (req, res) =>
  res.json(svc.cancelScheduledMessage(req.user.id, req.params.id)));
