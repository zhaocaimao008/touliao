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
const { badRequest, notFound, forbidden } = require('../../utils/http');
const broadcaster = require('../../realtime/broadcaster');
const { appendConversationEventTx, emitSyncAvailable } = require('../messages/sync.service');

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
  // 原子 CAS UPDATE：balance+delta>=0 才执行，避免读-判-写 TOCTOU（多进程 WAL 下并发双扣）
  const res = db.prepare(
    'UPDATE wallets SET balance=balance+?, updated_at=? WHERE user_id=? AND balance+?>=0'
  ).run(delta, nowSec(), userId, delta);
  if (res.changes === 0) throw badRequest('余额不足，请先充值', 'WALLET_INSUFFICIENT');
  const { balance: after } = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId);
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

/**
 * 好友转账：即时到账，双方各写一条流水，并在双方私聊会话发一条 type='transfer' 消息。
 * 金额单位：金币（整数），与红包一致，上限 20000。
 */
async function transfer(senderId, { to_user_id, amount, note }, io = null) {
  if (!to_user_id) throw badRequest('请填写收款人');
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0 || amt > 20000)
    throw badRequest('转账金额需为 1~20000 的整数（单位：金币）');
  if (to_user_id === senderId) throw badRequest('不能给自己转账');

  // 验证收款方存在且未注销
  const toUser = db.prepare('SELECT id, username FROM users WHERE id=? AND banned=0').get(to_user_id);
  if (!toUser) throw notFound('收款用户不存在');

  // 双方必须有私聊会话才能发消息气泡
  const conv = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm1 ON cm1.conversation_id=c.id AND cm1.user_id=?
    JOIN conversation_members cm2 ON cm2.conversation_id=c.id AND cm2.user_id=?
    WHERE c.type='private' LIMIT 1
  `).get(senderId, to_user_id);
  if (!conv) throw badRequest('请先与对方建立会话后再转账');

  const fromUser = db.prepare('SELECT username FROM users WHERE id=?').get(senderId);
  const safeNote = note && typeof note === 'string' ? note.trim().slice(0, 50) : '';
  const refId  = uuidv4(); // 两条流水共用同一 refId，方便对账
  const msgId  = uuidv4();
  const msgContent = JSON.stringify({ amount: amt, note: safeNote, refId });

  let serverSequence;
  try {
    db.transaction(() => {
      // 扣款（sender）— balance 不足时 applyDeltaTx 抛 WALLET_INSUFFICIENT 自动回滚
      applyDeltaTx(senderId,    -amt, 'transfer_out', refId, `转账给${toUser.username}`);
      // 入账（receiver）— 即时到账
      applyDeltaTx(to_user_id, +amt, 'transfer_in',  refId, `收到${fromUser.username}的转账`);
      // 消息入库
      serverSequence = appendConversationEventTx({
        conversationId: conv.id, eventType: 'message_created', messageId: msgId, actorId: senderId,
        apply: sequence => db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,server_sequence) VALUES (?,?,?,?,?,?)')
          .run(msgId, conv.id, senderId, 'transfer', msgContent, sequence),
      });
    })();
  } catch (e) {
    if (e.status) throw e; // ApiError 原样抛（如余额不足）
    console.error('[transfer] 转账失败:', e.code, e.message);
    throw new Error('转账失败，请重试');
  }

  // 读回消息体并 socket 广播
  const msg = db.prepare(
    'SELECT m.*, u.username as senderName, u.avatar as senderAvatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?'
  ).get(msgId);
  msg.reactions = [];
  msg.server_sequence = serverSequence;
  broadcaster.broadcastMessage(conv.id, msg);
  emitSyncAvailable(io, conv.id, serverSequence);

  return { success: true, balance: getBalance(senderId), message: msg };
}

module.exports = { ensureWallet, getBalance, applyDeltaTx, applyDelta, listTransactions, recharge, transfer };
