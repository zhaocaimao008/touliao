'use strict';
const { asyncHandler } = require('../../utils/http');
const svc = require('./wallet.service');

exports.balance = asyncHandler(async (req, res) =>
  res.json({ balance: svc.getBalance(req.user.id) }));

exports.transactions = asyncHandler(async (req, res) =>
  res.json(svc.listTransactions(req.user.id, { limit: req.query.limit, offset: req.query.offset })));

exports.recharge = asyncHandler(async (req, res) => {
  const amount = parseInt(req.body.amount, 10);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000)
    return res.status(400).json({ error: '充值金额需为 1~100000 的整数（单位：分）' });
  const { balance } = svc.recharge(req.user.id, amount);
  res.json({ success: true, balance, recharged: amount });
});
