'use strict';
const { asyncHandler } = require('../../utils/http');
const svc = require('./redpackets.service');

const io = req => req.app.get('io');

exports.send = asyncHandler(async (req, res) => {
  const { packetId, message } = await svc.send(io(req), req.user.id, req.body, req.get('Idempotency-Key'));
  res.json({ success: true, packetId, message });
});

exports.detail = asyncHandler(async (req, res) => res.json(svc.detail(req.user.id, req.params.packetId)));

exports.claim = asyncHandler(async (req, res) => {
  const { amount } = svc.claim(io(req), req.user.id, req.params.packetId);
  res.json({ success: true, amount });
});
