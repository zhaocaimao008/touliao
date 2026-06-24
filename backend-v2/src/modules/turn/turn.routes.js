'use strict';
/**
 * WebRTC ICE 服务器下发。
 *
 * 三端（Web / Android / iOS）在发起或接听通话前调用 GET /api/turn/credentials，
 * 拿到可直接喂给 RTCPeerConnection 的 iceServers，避免把 TURN 账号硬编码进客户端。
 *
 * TURN 走 coturn REST API 时效凭证（use-auth-secret 模式）：
 *   username   = <到期 unix 秒>:<userId>
 *   credential = base64( HMAC-SHA1(static-auth-secret, username) )
 * coturn 端需配置 use-auth-secret + static-auth-secret=<TURN_SECRET>。
 * 未配置 TURN_SECRET/TURN_URLS 时仅返回 STUN（退化为旧行为，但集中可控）。
 */
const router = require('express').Router();
const crypto = require('crypto');
const auth = require('../../middleware/auth');
const config = require('../../config');
const { asyncHandler } = require('../../utils/http');

// 生成时效 TURN 凭证 + 组装完整 iceServers（STUN 始终在前作兜底）
function buildIceServers(userId) {
  const { turn } = config;
  const iceServers = [];
  if (turn.stun.length) iceServers.push({ urls: turn.stun });
  if (turn.secret && turn.urls.length) {
    const expiry = Math.floor(Date.now() / 1000) + turn.ttl;
    const username = `${expiry}:${userId}`;
    const credential = crypto.createHmac('sha1', turn.secret).update(username).digest('base64');
    iceServers.push({ urls: turn.urls, username, credential });
  }
  return iceServers;
}

router.get('/credentials', auth, asyncHandler(async (req, res) => {
  res.json({ iceServers: buildIceServers(req.user.id), ttl: config.turn.ttl });
}));

module.exports = router;
module.exports.buildIceServers = buildIceServers;
