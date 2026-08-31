'use strict';
const { asyncHandler } = require('../../utils/http');
const config = require('../../config');
const svc = require('./wallet.service');

exports.balance = asyncHandler(async (req, res) =>
  res.json({ balance: svc.getBalance(req.user.id) }));

exports.transactions = asyncHandler(async (req, res) =>
  res.json(svc.listTransactions(req.user.id, { limit: req.query.limit, offset: req.query.offset })));

exports.recharge = asyncHandler(async (req, res) => {
  // 门控：无支付网关的自助充值默认禁用，防止任意用户自造余额（见 config.enableFakeRecharge）
  if (!config.enableFakeRecharge)
    return res.status(403).json({ error: '充值功能暂未开放', code: 'RECHARGE_DISABLED' });
  const amount = parseInt(req.body.amount, 10);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000)
    return res.status(400).json({ error: '充值金额需为 1~100000 的整数（单位：分）' });
  const { balance } = svc.recharge(req.user.id, amount);
  res.json({ success: true, balance, recharged: amount });
});

// 好友转账：POST /api/wallet/transfer
exports.transfer = asyncHandler(async (req, res) => {
  const { to_user_id, amount, note } = req.body;
  const result = await svc.transfer(req.user.id, {
    to_user_id,
    amount: parseInt(amount, 10),
    note,
  }, req.app.get('io'));
  res.json(result);
});
