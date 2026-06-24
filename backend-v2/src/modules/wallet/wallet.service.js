'use strict';
/**
 * 钱包账本：余额 + 流水。单位=金币(整数)。
 *
 * 核心约定：余额变动与流水写入必须在「同一事务」内完成（applyDeltaTx），
 * 由调用方（发/领红包等）开启事务时内联调用，保证扣款与业务写入要么全成、要么全回滚。
 * 单步操作（充值）用 applyDelta 自带事务。
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { badRequest } = require('../../utils/http');

const nowSec = () => Math.floor(Date.now() / 1000);

function ensureWallet(userId) {
  db.prepare('INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, 0)').run(userId);
}

function getBalance(userId) {
  ensureWallet(userId);
  return db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
}

/**
 * 在「调用方已开启的事务」内执行余额增减 + 记流水。delta 可正可负。
 * 结果余额为负则抛 WALLET_INSUFFICIENT，回滚整个外层事务。返回变动后余额。
 */
function applyDeltaTx(userId, delta, type, refId = null, memo = '') {
  db.prepare('INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, 0)').run(userId);
  const { balance } = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId);
  const after = balance + delta;
  if (after < 0) throw badRequest('余额不足，请先充值', 'WALLET_INSUFFICIENT');
  db.prepare('UPDATE wallets SET balance=?, updated_at=? WHERE user_id=?').run(after, nowSec(), userId);
  db.prepare(
    'INSERT INTO wallet_transactions (id,user_id,amount,balance_after,type,ref_id,memo) VALUES (?,?,?,?,?,?,?)'
  ).run(uuidv4(), userId, delta, after, type, refId, memo);
  return after;
}

/** 自带事务版（单步操作，如充值）。 */
function applyDelta(userId, delta, type, refId = null, memo = '') {
  return db.transaction(() => applyDeltaTx(userId, delta, type, refId, memo))();
}

function listTransactions(userId, { limit = 20, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  return db.prepare(
    'SELECT id, amount, balance_after, type, ref_id, memo, created_at FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?'
  ).all(userId, lim, off);
}

/** 充值（占位：无真实支付网关，直接入账。生产接入支付后改为支付回调触发）。 */
function recharge(userId, amount) {
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt < 1 || amt > 100000) throw badRequest('充值金额范围 1-100000 金币');
  const balance = applyDelta(userId, amt, 'recharge', null, '充值');
  return { balance };
}

module.exports = { ensureWallet, getBalance, applyDeltaTx, applyDelta, listTransactions, recharge };
