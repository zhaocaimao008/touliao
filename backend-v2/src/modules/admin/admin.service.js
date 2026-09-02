'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');
const { db } = require('../../db/connection');
const { badRequest, notFound, unauthorized } = require('../../utils/http');
const { purgeConversation, invalidateConv } = require('../messages/shared');
const messages = require('../messages/messages.service');
const moments = require('../moments/moments.service');
const wallet = require('../wallet/wallet.service');
const { invalidateUser } = require('../../utils/userStatusCache');
const { logAuditEvent } = require('../../utils/auditLogger');

// ── 凭证校验（恒定时间比较，防时序侧信道）──────────────────────
function timingSafeEqual(a, b) {
  const ba = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// 多管理员（2026-09-02）：两条独立校验路径，谁先命中用谁的身份。
// 路径①env 根管理员——永久保留、永不下线，即便 admin_users 表或其查询出问题，
//   这条路径完全不碰该表，后台入口不会被锁死。
// 路径②DB admin_users 表——后台可增删的多管理员，每人独立用户名密码，role 区分权限。
// 返回真实登录者身份 { username, role, adminId }，供 controller 签发 JWT 时使用
// （此前这里只返回布尔值，controller 转头又硬编码 config.admin.username 签 token——
// 即便将来真的加了别的管理员账号，登录成功后 cookie 里仍会写成 env 账号，是本次要修的核心问题）。
function verifyCredentials(username, password) {
  const hasEnvAdmin = !!(config.admin.username && config.admin.password);
  if (hasEnvAdmin) {
    const okUser = timingSafeEqual(username, config.admin.username);
    const okPass = timingSafeEqual(password, config.admin.password);
    if (okUser && okPass) return { username: config.admin.username, role: 'superadmin', adminId: 'env-root' };
  }
  const row = db.prepare('SELECT * FROM admin_users WHERE username=? AND disabled=0').get(username);
  if (row && bcrypt.compareSync(password, row.password_hash)) {
    return { username: row.username, role: row.role, adminId: row.id };
  }
  if (!hasEnvAdmin && db.prepare('SELECT COUNT(*) n FROM admin_users').get().n === 0) {
    throw badRequest('后台未配置：请在 .env 设置 ADMIN_USERNAME / ADMIN_PASSWORD，或先用该账号登录后在"安全"页新增管理员');
  }
  throw unauthorized('账号或密码错误');
}

// ── 管理员账号管理（仅 superadmin 可操作，见 routes 里的角色门控）─
function listAdmins() {
  const rows = db.prepare('SELECT id, username, role, disabled, created_by, created_at FROM admin_users ORDER BY created_at DESC').all();
  const envRow = config.admin.username
    ? [{ id: 'env-root', username: config.admin.username, role: 'superadmin', disabled: 0, created_by: null, created_at: null, isEnvRoot: true }]
    : [];
  return [...envRow, ...rows];
}

async function createAdmin({ username, password, role }, createdBy) {
  if (!username || typeof username !== 'string' || username.length < 2 || username.length > 30)
    throw badRequest('用户名长度需为 2-30 字符');
  if (!password || typeof password !== 'string' || password.length < 8)
    throw badRequest('密码至少 8 位');
  const r = role === 'superadmin' ? 'superadmin' : 'admin';
  if (config.admin.username && timingSafeEqual(username, config.admin.username))
    throw badRequest('该用户名已被占用');
  const id = uuidv4();
  const hash = await bcrypt.hash(password, 12);
  try {
    db.prepare('INSERT INTO admin_users (id, username, password_hash, role, created_by) VALUES (?,?,?,?,?)')
      .run(id, username, hash, r, createdBy || null);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw badRequest('该用户名已存在');
    throw e;
  }
  return { id, username, role: r };
}

function setAdminDisabled(id, disabled, actingAdminId) {
  if (id === 'env-root') throw badRequest('env 根管理员不可禁用，如需下线请从 .env 移除 ADMIN_USERNAME/ADMIN_PASSWORD');
  if (id === actingAdminId) throw badRequest('不能禁用自己');
  const row = db.prepare('SELECT id FROM admin_users WHERE id=?').get(id);
  if (!row) throw notFound('管理员不存在');
  db.prepare('UPDATE admin_users SET disabled=? WHERE id=?').run(disabled ? 1 : 0, id);
  return { success: true };
}

function deleteAdmin(id, actingAdminId) {
  if (id === 'env-root') throw badRequest('env 根管理员不可删除，如需下线请从 .env 移除 ADMIN_USERNAME/ADMIN_PASSWORD');
  if (id === actingAdminId) throw badRequest('不能删除自己');
  const row = db.prepare('SELECT id FROM admin_users WHERE id=?').get(id);
  if (!row) throw notFound('管理员不存在');
  db.prepare('DELETE FROM admin_users WHERE id=?').run(id);
  return { success: true };
}

// ── 数据总览 ────────────────────────────────────────────────────
function stats(onlineCount) {
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  const one = sql => db.prepare(sql);
  return {
    users:         one('SELECT COUNT(*) n FROM users').get().n,
    usersBanned:   one('SELECT COUNT(*) n FROM users WHERE banned=1').get().n,
    usersToday:    one('SELECT COUNT(*) n FROM users WHERE created_at > ?').get(dayAgo).n,
    online:        onlineCount,
    messages:      one('SELECT COUNT(*) n FROM messages WHERE deleted=0').get().n,
    messagesToday: one('SELECT COUNT(*) n FROM messages WHERE deleted=0 AND created_at > ?').get(dayAgo).n,
    conversations: one("SELECT COUNT(*) n FROM conversations").get().n,
    groups:        one("SELECT COUNT(*) n FROM conversations WHERE type='group'").get().n,
    redPackets:    one('SELECT COUNT(*) n FROM red_packets').get().n,
  };
}

// ── 用户列表（搜索 + 分页）──────────────────────────────────────
const escapeLike = s => s.replace(/[%_\\]/g, c => '\\' + c);

function listUsers({ q, limit = 30, offset = 0, banned, period, online }) {
  const lim = Math.min(parseInt(limit) || 30, 100);
  const off = Math.max(parseInt(offset) || 0, 0);
  const like = q ? `%${escapeLike(q)}%` : null;
  const truthy = v => v === '1' || v === 1 || v === true;

  const conds = [], args = [];
  if (q) { conds.push("(u.username LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.wechat_id LIKE ? ESCAPE '\\')"); args.push(like, like, like); }
  if (truthy(banned)) conds.push('u.banned=1');
  if (truthy(online)) conds.push("u.status='online'");
  if (period === 'today') { conds.push('u.created_at > ?'); args.push(Math.floor(Date.now() / 1000) - 86400); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) n FROM users u ${where}`).get(...args).n;
  const rows = db.prepare(`
    SELECT u.id, u.username, u.phone, u.wechat_id, u.avatar, u.bio, u.status, u.banned, u.is_privileged, u.created_at,
      (SELECT COUNT(*) FROM contacts WHERE user_id=u.id) AS contactCount,
      (SELECT COUNT(*) FROM messages WHERE sender_id=u.id AND deleted=0) AS messageCount
    FROM users u ${where}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...args, lim, off);
  return { total, limit: lim, offset: off, users: rows };
}

function userDetail(id) {
  const user = db.prepare(`
    SELECT id, username, phone, wechat_id, avatar, cover_photo, bio, status, banned, created_at,
           invite_code, invited_by
    FROM users WHERE id=?
  `).get(id);
  if (!user) throw notFound('用户不存在');
  // 裂变统计：本人邀请到多少人 + 是谁邀请了本人
  user.invitedCount = db.prepare('SELECT COUNT(*) n FROM users WHERE invited_by=?').get(id).n;
  user.inviterName = user.invited_by
    ? (db.prepare('SELECT username FROM users WHERE id=?').get(user.invited_by)?.username || '（已注销）')
    : null;
  user.contactCount = db.prepare('SELECT COUNT(*) n FROM contacts WHERE user_id=?').get(id).n;
  user.messageCount = db.prepare('SELECT COUNT(*) n FROM messages WHERE sender_id=? AND deleted=0').get(id).n;
  user.groupCount   = db.prepare("SELECT COUNT(*) n FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id AND c.type='group' WHERE cm.user_id=?").get(id).n;
  user.sessions     = db.prepare('SELECT device, platform, ip, last_seen FROM user_sessions WHERE user_id=? ORDER BY last_seen DESC').all(id);
  user.balance      = wallet.getBalance(id);
  return user;
}

// ── 后台发币（给指定用户钱包入账，走账本+流水）─────────────────────
function grantCoins(id, amount, memo) {
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt === 0 || amt < -1000000 || amt > 1000000)
    throw badRequest('发币金额需为非零整数，绝对值≤1000000');
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) throw notFound('用户不存在');
  // amt 可正可负（负=扣减/冲正）。applyDelta 内置余额不足保护。
  const balance = wallet.applyDelta(id, amt, 'admin_grant', null, memo || (amt > 0 ? '后台发币' : '后台扣减'));
  return { id, balance, granted: amt };
}

// ── 特权账户：可查看好友精确最后在线时间 ────────────────────────
function setPrivilege(id, privileged) {
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) throw notFound('用户不存在');
  db.prepare('UPDATE users SET is_privileged=? WHERE id=?').run(privileged ? 1 : 0, id);
  return { id, is_privileged: privileged ? 1 : 0 };
}

// ── 封禁 / 解封 ─────────────────────────────────────────────────
function setBanned(io, id, banned) {
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) throw notFound('用户不存在');
  db.prepare('UPDATE users SET banned=? WHERE id=?').run(banned ? 1 : 0, id);
  invalidateUser(id); // 驱逐状态缓存，封禁立即生效
  if (banned && io) io.to(`user_${id}`).disconnectSockets(true);
  return { id, banned: banned ? 1 : 0 };
}

// ── 重置密码 ────────────────────────────────────────────────────
async function resetPassword(io, id, newPassword) {
  if (typeof newPassword !== 'string' || !/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(newPassword))
    throw badRequest('新密码至少8位，且须包含字母和数字');
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) throw notFound('用户不存在');
  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password=?, password_changed_at=? WHERE id=?').run(hash, Math.floor(Date.now() / 1000), id);
  invalidateUser(id); // 驱逐状态缓存，令旧 JWT 立即失效
  // 踢掉该用户所有会话并强制断开 socket，使旧 JWT 立即失效
  db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(id);
  if (io) io.to(`user_${id}`).disconnectSockets(true);
}

// ── 彻底删除用户（级联清理，含其消息）──────────────────────────
function deleteUser(io, id) {
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) throw notFound('用户不存在');

  db.transaction(() => {
    // P1-05：资金守恒 —— 删除前先结清该用户「发出且在途」的红包，剩余金额
    // 原路退回本人钱包（复用注销结算口径：status CAS 防双花，同一红包只退一次）。
    const redpackets = require('../redpackets/redpackets.service');
    redpackets.settleUserActivePacketsTx(id);
    // 钱包余额：记账后清零（每分钱都有 ledger 去向，不凭空消失）；
    // wallet_transactions 保留作审计痕迹（下方不再 DELETE）。
    const walletRow = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(id);
    if (walletRow && walletRow.balance > 0) {
      wallet.applyDeltaTx(id, -walletRow.balance, 'admin_delete_refund', null, '管理员删除用户·余额清零');
    }

    // 该用户发的消息及其衍生数据（用子查询避免 IN(?) 参数爆炸）
    db.prepare('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE sender_id=?)').run(id);
    db.prepare('DELETE FROM message_deliveries WHERE message_id IN (SELECT id FROM messages WHERE sender_id=?)').run(id);
    db.prepare('DELETE FROM messages_fts WHERE message_id IN (SELECT id FROM messages WHERE sender_id=?)').run(id);
    db.prepare('DELETE FROM pinned_messages WHERE message_id IN (SELECT id FROM messages WHERE sender_id=?)').run(id);
    db.prepare('DELETE FROM messages WHERE sender_id=?').run(id);
    // 该用户参与/产生的关系数据
    db.prepare('DELETE FROM message_reactions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM message_deliveries WHERE user_id=?').run(id);
    db.prepare('DELETE FROM contacts WHERE user_id=? OR contact_id=?').run(id, id);
    db.prepare('DELETE FROM friend_requests WHERE from_id=? OR to_id=?').run(id, id);
    db.prepare('DELETE FROM blocked_users WHERE user_id=? OR blocked_id=?').run(id, id);
    db.prepare('DELETE FROM conversation_settings WHERE user_id=?').run(id);
    db.prepare('DELETE FROM conversation_clears WHERE user_id=?').run(id);
    // 该用户作为群主(owner)的群：删除其成员身份会使 owner_id 悬空。
    // 先处理——优先转让给群内"最早加入的其他成员"，无其他成员则整群解散。
    // 必须在下面删 conversation_members 之前做，否则查不到其他成员。
    const ownedGroups = db.prepare("SELECT id FROM conversations WHERE type='group' AND owner_id=?").all(id);
    for (const g of ownedGroups) {
      const heir = db.prepare(
        'SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id!=? ORDER BY joined_at ASC, user_id ASC LIMIT 1'
      ).get(g.id, id);
      if (heir) {
        // 转让：新群主 owner_id + role=owner；被删用户的成员行由后续 DELETE ... WHERE user_id=? 清理
        db.prepare('UPDATE conversations SET owner_id=? WHERE id=?').run(heir.user_id, g.id);
        db.prepare("UPDATE conversation_members SET role='owner' WHERE conversation_id=? AND user_id=?").run(g.id, heir.user_id);
      } else {
        // 无其他成员 → 解散整群（按外键依赖顺序级联，与 purgeConversation 一致；
        // 此处内联以复用当前事务，避免 better-sqlite3 嵌套事务报错）。
        // P1-05 洞 B：解散前先结算该群在途红包（含已退群成员发出的），
        // 剩余原路退回各自 sender，否则直接 DELETE 会凭空销毁他人资金。
        redpackets.settleConversationPacketsTx(g.id);
        const msgIds = db.prepare('SELECT id FROM messages WHERE conversation_id=?').all(g.id).map(r => r.id);
        for (let i = 0; i < msgIds.length; i += 500) {
          const chunk = msgIds.slice(i, i + 500);
          const ph = chunk.map(() => '?').join(',');
          db.prepare(`DELETE FROM message_reactions WHERE message_id IN (${ph})`).run(...chunk);
          db.prepare(`DELETE FROM message_deliveries WHERE message_id IN (${ph})`).run(...chunk);
          db.prepare(`DELETE FROM messages_fts WHERE message_id IN (${ph})`).run(...chunk);
          db.prepare(`DELETE FROM pinned_messages WHERE message_id IN (${ph})`).run(...chunk);
        }
        db.prepare('DELETE FROM pinned_messages WHERE conversation_id=?').run(g.id);
        db.prepare('DELETE FROM red_packet_claims WHERE packet_id IN (SELECT id FROM red_packets WHERE conversation_id=?)').run(g.id);
        db.prepare('DELETE FROM red_packets WHERE conversation_id=?').run(g.id);
        db.prepare('DELETE FROM messages WHERE conversation_id=?').run(g.id);
        db.prepare('DELETE FROM conversation_settings WHERE conversation_id=?').run(g.id);
        db.prepare('DELETE FROM conversation_clears WHERE conversation_id=?').run(g.id);
        db.prepare('DELETE FROM group_invite_tokens WHERE conversation_id=?').run(g.id);
        db.prepare('DELETE FROM conversation_members WHERE conversation_id=?').run(g.id);
        db.prepare('DELETE FROM conversations WHERE id=?').run(g.id);
      }
    }
    db.prepare('DELETE FROM conversation_members WHERE user_id=?').run(id);
    db.prepare('DELETE FROM user_settings WHERE user_id=?').run(id);
    db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM device_tokens WHERE user_id=?').run(id);
    db.prepare('DELETE FROM collections WHERE user_id=?').run(id);
    // P1-05 洞 A：该用户领取「他人红包」的领取行不能物理删除——否则他人红包
    // SUM(claimed) 变小 → remaining 虚增 → 到期回收 double refund（同一笔钱付两次）。
    // FK ON 下 user_id 必须指向存在的 users 行，故转移给系统占位用户（ghost，
    // offline 永不登录），保留 SUM(claimed)；自己发的红包的领取行随下方
    // packet_id IN (sender_id=?) 清理。
    // ⚠ ghost 用户名不能用固定 'ghost'：真实用户可注册该名（无字符集限制）→
    //   INSERT OR IGNORE 被 UNIQUE 静默跳过 → UPDATE claims 触发 FK 违规 500。
    //   改用随机后缀（username 限 2-20 字符，含 '_'+12hex 合法但不可能被注册）
    //   + 存在性检查幂等，彻底消除碰撞。
    const GHOST_ID = '00000000-0000-0000-0000-000000000000';
    const ghostRow = db.prepare('SELECT id FROM users WHERE id=?').get(GHOST_ID);
    if (!ghostRow) {
      const gs = require('uuid').v4().replace(/-/g, '').slice(0, 12);
      db.prepare(
        "INSERT INTO users (id,username,phone,password,status) VALUES (?,?,?,?,'offline')"
      ).run(GHOST_ID, `ghost_${gs}`, `ghost_${gs}@x`, '!');
    }
    db.prepare(`
      UPDATE red_packet_claims SET user_id=?
      WHERE user_id=? AND packet_id IN (SELECT id FROM red_packets WHERE sender_id != ?)
    `).run(GHOST_ID, id, id);
    db.prepare('DELETE FROM red_packet_claims WHERE packet_id IN (SELECT id FROM red_packets WHERE sender_id=?)').run(id);
    db.prepare('DELETE FROM red_packets WHERE sender_id=?').run(id);
    // wallet_transactions 保留作审计痕迹（P1-05：删除前已结算红包/余额清零并记账，流水不可抹除）
    db.prepare('DELETE FROM wallets WHERE user_id=?').run(id);
    db.prepare('DELETE FROM device_accounts WHERE user_id=?').run(id);
    db.prepare('DELETE FROM user_stickers WHERE user_id=?').run(id);
    // 先清该用户对他人动态的互动记录（自身动态的互动由 ON DELETE CASCADE 随 moments 删除）
    db.prepare('DELETE FROM moment_likes WHERE user_id=?').run(id);
    db.prepare('DELETE FROM moment_comments WHERE user_id=?').run(id);
    db.prepare("DELETE FROM moment_notifications WHERE user_id=? OR actor_id=?").run(id, id);
    db.prepare('DELETE FROM moment_reports WHERE reporter_id=?').run(id);
    db.prepare('DELETE FROM moments WHERE user_id=?').run(id);
    // 清理只剩 0 个成员的私聊会话
    db.prepare(`
      DELETE FROM conversations WHERE type='private'
        AND id NOT IN (SELECT DISTINCT conversation_id FROM conversation_members)
    `).run();
    db.prepare('DELETE FROM users WHERE id=?').run(id);
  })();
  invalidateUser(id); // 驱逐状态缓存
  if (io) io.to(`user_${id}`).disconnectSockets(true);
}

// ── 消息监控（今日 / 搜索）──────────────────────────────────────
function listMessages({ q, period, limit = 30, offset = 0 }) {
  const lim = Math.min(parseInt(limit) || 30, 100);
  const off = Math.max(parseInt(offset) || 0, 0);
  const conds = ['m.deleted=0'], args = [];
  if (period === 'today') { conds.push('m.created_at > ?'); args.push(Math.floor(Date.now() / 1000) - 86400); }
  if (q) { conds.push("m.content LIKE ? ESCAPE '\\'"); args.push(`%${escapeLike(q)}%`); }
  const where = 'WHERE ' + conds.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) n FROM messages m ${where}`).get(...args).n;
  const rows = db.prepare(`
    SELECT m.id, m.type, m.content, m.created_at, m.conversation_id,
           u.username AS senderName, c.type AS convType, c.name AS convName
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    JOIN conversations c ON c.id = m.conversation_id
    ${where}
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, lim, off);
  return { total, limit: lim, offset: off, messages: rows };
}

// 管理员撤回一条消息（内容审核，2026-09-02）：复用普通撤回同一套 DB 语义与广播，
// 跳过会话成员/角色校验，见 messages.service.js adminRecall 注释。
function deleteMessage(io, msgId) {
  return messages.adminRecall(io, msgId);
}

// ── 群列表 / 详情 / 解散 ────────────────────────────────────────
function listGroups({ q, limit = 30, offset = 0 }) {
  const lim = Math.min(parseInt(limit) || 30, 100);
  const off = Math.max(parseInt(offset) || 0, 0);
  const like = q ? `%${escapeLike(q)}%` : null;
  const where = q ? "AND (c.name LIKE ? ESCAPE '\\' OR c.group_number LIKE ? ESCAPE '\\')" : '';
  const args = q ? [like, like] : [];

  const total = db.prepare(`SELECT COUNT(*) n FROM conversations c WHERE c.type='group' ${where}`).get(...args).n;
  const rows = db.prepare(`
    SELECT c.id, c.name, c.group_number, c.avatar, c.owner_id, c.created_at,
      ou.username AS ownerName,
      (SELECT COUNT(*) FROM conversation_members WHERE conversation_id=c.id) AS memberCount,
      (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND deleted=0) AS messageCount
    FROM conversations c
    LEFT JOIN users ou ON ou.id = c.owner_id
    WHERE c.type='group' ${where}
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...args, lim, off);
  return { total, limit: lim, offset: off, groups: rows };
}

function groupDetail(id) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id=? AND type='group'").get(id);
  if (!conv) throw notFound('群不存在');
  conv.members = db.prepare(`
    SELECT u.id, u.username, u.avatar, cm.role, cm.joined_at
    FROM conversation_members cm JOIN users u ON u.id=cm.user_id
    WHERE cm.conversation_id=?
    ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, cm.joined_at
    LIMIT 500
  `).all(id);
  return conv;
}

function dismissGroup(io, id) {
  const conv = db.prepare("SELECT id FROM conversations WHERE id=? AND type='group'").get(id);
  if (!conv) throw notFound('群不存在');
  purgeConversation(id); // 完整级联清理，含消息（修复外键约束 500）
  if (io) io.to(id).emit('group_dismissed', { conversationId: id });
}

// ── 群管理中间态（2026-09-02）：此前只能"查看"或"强制解散"，没有更轻量的操作。
// 两个函数都跳过 groups.service.js 里 memberRole 的群主/管理员校验——平台管理员
// 本就不在群里，权限高于群内角色，直接对 conversations/conversation_members 表操作。

// 全员禁言开关（不影响群主/管理员本身能否发言，与群内"全员禁言"语义一致——见 messages 发送路径的 mute_all 判断）
function muteGroup(io, id, muteAll) {
  const conv = db.prepare("SELECT id FROM conversations WHERE id=? AND type='group'").get(id);
  if (!conv) throw notFound('群不存在');
  db.prepare('UPDATE conversations SET mute_all=? WHERE id=?').run(muteAll ? 1 : 0, id);
  if (io) io.to(id).emit('group_settings_updated', { id, mute_all: muteAll ? 1 : 0 });
  return { id, mute_all: muteAll ? 1 : 0 };
}

// 移除单个成员：不允许移除群主（会留下"有群但无主"的孤儿群，需走 dismissGroup 整体解散）。
function kickMember(io, id, userId) {
  const conv = db.prepare("SELECT owner_id FROM conversations WHERE id=? AND type='group'").get(id);
  if (!conv) throw notFound('群不存在');
  if (conv.owner_id === userId) throw badRequest('不能移除群主，如需清退请解散该群');
  const targetRole = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(id, userId);
  if (!targetRole) throw notFound('成员不存在');
  db.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?').run(id, userId);
  invalidateConv(id); // isMember 缓存立即失效，防移除后短暂仍可访问群附件
  if (io) {
    io.in(`user_${userId}`).socketsLeave(id);
    io.to(id).emit('group_updated', { id });
    io.to(`user_${userId}`).emit('group_kicked', { conversationId: id });
  }
  return { success: true };
}

// ── 邀请码（运行时可改，存 admin_settings，回退 .env）────────────
function getInviteCode() {
  const row = db.prepare("SELECT value FROM admin_settings WHERE key='invite_code'").get();
  return row?.value ?? config.inviteCode;
}
function setInviteCode(code) {
  if (!code || !/^\d{6}$/.test(code)) throw badRequest('邀请码必须是6位数字');
  db.prepare(`
    INSERT INTO admin_settings (key, value, updated_at) VALUES ('invite_code', ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(code);
  return code;
}

// 随机生成并保存一个 6 位数字邀请码
function generateInviteCode() {
  return setInviteCode(String(Math.floor(100000 + Math.random() * 900000)));
}

// ── 功能开关（后台可隐藏：朋友圈 / 收藏 / 群语音 / 群视频 / 自助改密；注册是否需邀请码）默认开启 ─
// inviteRequired=true 表示注册需填写邀请码（默认）；false 则关闭邀请码校验，任何人可注册。
// groupVoiceCall / groupVideoCall=true 表示允许发起群语音 / 群视频通话（默认开启，可随时关闭）。
// changePassword=true 表示允许用户自助修改密码（默认开启，关闭后隐藏入口并后端拦截）。
// loginCaptcha=true 表示登录必须提交图形验证码（默认关闭，与其它开关"默认开启"相反——
// 必须先确认四端客户端都已升级到能取图+提交验证码，才能安全打开，见 AUDIT.md 十节🟡）。
function getFeatures() {
  const get = k => db.prepare('SELECT value FROM admin_settings WHERE key=?').get(k)?.value;
  return {
    moments: get('feature_moments') !== 'off',
    collect: get('feature_collect') !== 'off',
    inviteRequired: get('invite_required') !== 'off',
    groupVoiceCall: get('feature_group_voice_call') !== 'off',
    groupVideoCall: get('feature_group_video_call') !== 'off',
    changePassword: get('feature_change_password') !== 'off',
    loginCaptcha: get('feature_login_captcha') === 'on',
    // AI 助手入口列表（四端通讯录固定分组;数据来自 .env botId 绑定的机器人账号）
    aiAssistants: getBotList(),
  };
}
function getBotList() {
  const { getBotList: getAiBots } = require('../ai-assistant/assistant.service');
  return getAiBots();
}
function setFeatures({ moments, collect, inviteRequired, groupVoiceCall, groupVideoCall, changePassword, loginCaptcha }) {
  const set = (k, on) => db.prepare(`
    INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(k, on ? 'on' : 'off');
  if (moments !== undefined) set('feature_moments', !!moments);
  if (collect !== undefined) set('feature_collect', !!collect);
  if (inviteRequired !== undefined) set('invite_required', !!inviteRequired);
  if (groupVoiceCall !== undefined) set('feature_group_voice_call', !!groupVoiceCall);
  if (groupVideoCall !== undefined) set('feature_group_video_call', !!groupVideoCall);
  if (changePassword !== undefined) set('feature_change_password', !!changePassword);
  if (loginCaptcha !== undefined) set('feature_login_captcha', !!loginCaptcha);
  return getFeatures();
}

// ── 邀请裂变排行榜（后台）：谁拉新最多 ─────────────────────────
function topInviters({ limit = 20 } = {}) {
  const lim = Math.min(parseInt(limit) || 20, 100);
  // 只统计真实存在的邀请人（invited_by 指向的用户），按被邀人数降序
  const rows = db.prepare(`
    SELECT u.id, u.username, u.wechat_id, u.avatar, u.banned,
           COUNT(inv.id) AS invitedCount
    FROM users u
    JOIN users inv ON inv.invited_by = u.id
    GROUP BY u.id
    ORDER BY invitedCount DESC, u.created_at ASC
    LIMIT ?
  `).all(lim);
  const totalInvited = db.prepare('SELECT COUNT(*) n FROM users WHERE invited_by IS NOT NULL').get().n;
  return { totalInvited, limit: lim, inviters: rows };
}

// ── 朋友圈举报队列（MO6 后台）──────────────────────────────────
function listReports({ status = 'pending', limit = 30, offset = 0 } = {}) {
  const lim = Math.min(parseInt(limit) || 30, 100);
  const off = Math.max(parseInt(offset) || 0, 0);
  const st = ['pending', 'reviewed', 'dismissed'].includes(status) ? status : 'pending';
  const total = db.prepare('SELECT COUNT(*) n FROM moment_reports WHERE status=?').get(st).n;
  const rows = db.prepare(`
    SELECT r.id, r.moment_id, r.reason, r.status, r.created_at,
           ru.username AS reporterName,
           m.content AS momentContent, m.images AS momentImages, m.user_id AS authorId,
           au.username AS authorName,
           (SELECT COUNT(*) FROM moment_reports x WHERE x.moment_id = r.moment_id) AS reportCount
    FROM moment_reports r
    LEFT JOIN users ru ON ru.id = r.reporter_id
    LEFT JOIN moments m ON m.id = r.moment_id
    LEFT JOIN users au ON au.id = m.user_id
    WHERE r.status = ?
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `).all(st, lim, off);
  return {
    total, limit: lim, offset: off,
    reports: rows.map(r => ({ ...r, momentImages: JSON.parse(r.momentImages || '[]') })),
  };
}

// 处理举报：delete=删被举报动态；reviewed=标记已看；dismissed=忽略
function resolveReport(reportId, action) {
  if (!['delete', 'reviewed', 'dismissed'].includes(action))
    throw badRequest('action 必须为 delete / reviewed / dismissed');
  const r = db.prepare('SELECT * FROM moment_reports WHERE id=?').get(reportId);
  if (!r) throw notFound('举报不存在');
  if (action === 'delete') {
    moments.purgeMoment(r.moment_id);   // 复用 moments.service 的级联删除
    return { success: true, action: 'deleted' };
  }
  db.prepare('UPDATE moment_reports SET status=? WHERE id=?').run(action, reportId);
  return { success: true, action };
}

module.exports = {
  verifyCredentials, stats, listUsers, userDetail, setBanned, resetPassword,
  setPrivilege,
  listAdmins, createAdmin, setAdminDisabled, deleteAdmin,
  grantCoins, deleteUser, listMessages, deleteMessage, listGroups, groupDetail, dismissGroup,
  muteGroup, kickMember,
  getInviteCode, setInviteCode, generateInviteCode,
  getFeatures, setFeatures,
  topInviters,
  listReports, resolveReport,
};
