'use strict';
const { asyncHandler } = require('../../utils/http');
const svc = require('./wallet.service');

exports.balance = asyncHandler(async (req, res) =>
  res.json({ balance: svc.getBalance(req.user.id) }));

exports.transactions = asyncHandler(async (req, res) =>
  res.json(svc.listTransactions(req.user.id, { limit: req.query.limit, offset: req.query.offset })));

exports.recharge = asyncHandler(async (req, res) =>
  res.status(503).json({ error: '充值功能暂未开放，敬请期待' }));
