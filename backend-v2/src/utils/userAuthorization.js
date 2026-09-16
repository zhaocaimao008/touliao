'use strict';
const { readDb } = require('../db/connection');
const { isBlacklisted } = require('./tokenBlacklist');
const { getUserStatus, setUserStatus } = require('./userStatusCache');
const { hasActiveSession, passwordRevoked } = require('./sessionAuthorization');

// Shared by normal HTTP authentication and the issuer check for scoped media tickets.
// Callers verify the signature and the credential blacklist before passing this payload.
async function userAuthorizationError(payload) {
  if (!payload || typeof payload.id !== 'string' || !payload.id || payload.file || payload.purpose) {
    return { status: 401, error: '未授权' };
  }
  if (payload.jti && ((await isBlacklisted(`jti:${payload.jti}`)) || !hasActiveSession(payload))) {
    return { status: 401, error: '该会话已失效，请重新登录' };
  }
  let row = getUserStatus(payload.id);
  if (!row || !payload.jti) {
    row = readDb.prepare('SELECT banned, password_changed_at FROM users WHERE id=?').get(payload.id);
    if (row) setUserStatus(payload.id, row.banned, row.password_changed_at);
  }
  if (!row) return { status: 401, error: '用户不存在，请重新登录' };
  if (row.banned) return { status: 403, error: '账号已被封禁' };
  if (passwordRevoked(payload, row.password_changed_at)) {
    return { status: 401, error: '密码已修改，请重新登录' };
  }
  return null;
}

module.exports = { userAuthorizationError };
