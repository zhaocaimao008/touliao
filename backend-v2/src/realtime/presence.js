'use strict';
/**
 * 在线状态 / 用户资料缓存 / 逐用户消息限流。
 * 进程内单例，被各 socket handler 共享。
 */
const config = require('../config');
const { readDb } = require('../db/connection');
const { write } = require('../db/writer');

const onlineUsers  = new Map(); // userId → Set<socketId>
const socketPlatform = new Map(); // socketId → platform（握手上报，未上报则 'unknown'）
const userProfiles = new Map(); // userId → { username, avatar }

// ── 在线集合 ────────────────────────────────────────────────────
// platform 由客户端握手时上报（'web'|'desktop'|'android'|'ios'，未上报则 'unknown'）。
// 账号级 isOnline 语义不变（消息在线投递等既有调用方继续用账号维度）；
// 来电推送兜底需要平台维度判定（见 onlinePlatforms），故额外记录每个 socket 的平台。
function addSocket(userId, socketId, platform) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
  socketPlatform.set(socketId, platform || 'unknown');
}
function removeSocket(userId, socketId) {
  socketPlatform.delete(socketId);
  const s = onlineUsers.get(userId);
  if (!s) return true;
  s.delete(socketId);
  if (s.size === 0) { onlineUsers.delete(userId); return true; }
  return false;
}
function isOnline(uid)     { return (onlineUsers.get(uid)?.size || 0) > 0; }
function onlineUserIdSet() { return new Set(onlineUsers.keys()); }
// 该用户当前有活跳 socket 的平台集合，如 {'web','android'}。
// 用于来电推送兜底按平台维度判定（同账号 Web 在线不应压制 Android 的来电推送/响铃）。
function onlinePlatforms(uid) {
  const set = new Set();
  const socketIds = onlineUsers.get(uid);
  if (!socketIds) return set;
  for (const sid of socketIds) set.add(socketPlatform.get(sid) || 'unknown');
  return set;
}
// 监控：在线用户数 + 总连接数（多端聚合）
function stats() {
  let sockets = 0;
  for (const s of onlineUsers.values()) sockets += s.size;
  return { users: onlineUsers.size, sockets };
}

// ── 资料缓存（send_message 免 SELECT）──────────────────────────
function cacheProfile(userId) {
  if (userProfiles.has(userId)) return;
  try {
    const p = readDb.prepare('SELECT username, avatar FROM users WHERE id=?').get(userId);
    if (p) userProfiles.set(userId, { username: p.username, avatar: p.avatar || '' });
  } catch (err) {
    console.error('[presence] cacheProfile error:', err);
  }
}
function getProfile(userId) { return userProfiles.get(userId) || {}; }
// 资料更新时只清缓存，不影响限流计数
function dropProfile(userId) { userProfiles.delete(userId); }
// 最后一台设备断开时全量清理：资料缓存 + 限流计数（防 Map 随历史用户无限增长）
function cleanupUser(userId) { userProfiles.delete(userId); msgRateLimiter.delete(userId); }

// ── 逐用户消息限流：每秒 N 条 ──────────────────────────────────
const msgRateLimiter = new Map();
function checkMsgRate(userId) {
  const now = Date.now();
  const r = msgRateLimiter.get(userId);
  if (!r || now >= r.reset) {
    msgRateLimiter.set(userId, { count: 1, reset: now + config.limits.msgRateWindow });
    return true;
  }
  if (r.count >= config.limits.msgRateLimit) return false;
  r.count++;
  return true;
}

// ── 送达记录（worker 异步写）────────────────────────────────────
function recordDeliveries(messageId, userIds) {
  const sql = 'INSERT OR IGNORE INTO message_deliveries (message_id, user_id) VALUES (?,?)';
  for (const uid of userIds) write(sql, [messageId, uid]);
}

module.exports = {
  onlineUsers, addSocket, removeSocket, isOnline, onlinePlatforms, onlineUserIdSet, stats,
  cacheProfile, getProfile, dropProfile, cleanupUser, checkMsgRate, recordDeliveries,
};
