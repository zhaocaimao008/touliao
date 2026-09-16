'use strict';
const config = require('../config');
const { db } = require('../db/connection');

// JWT signatures prove issuance, not that an administrator still has access.
function currentAdmin(payload) {
  if (payload?.admin !== true || payload.id || payload.file || payload.purpose) return null;
  if (!payload.adminId || payload.adminId === 'env-root') {
    if (!config.admin.password || payload.username !== config.admin.username) return null;
    return { ...payload, adminId: 'env-root', role: 'superadmin' };
  }
  if (typeof payload.adminId !== 'string') return null;
  const row = db.prepare('SELECT id, username, role, disabled FROM admin_users WHERE id=?').get(payload.adminId);
  if (!row || row.disabled || row.username !== payload.username || !['admin', 'superadmin'].includes(row.role)) return null;
  return { ...payload, username: row.username, role: row.role, adminId: row.id };
}

function allowedAdminIp(ip) {
  const whitelist = config.admin.ipWhitelist;
  return !whitelist.length || whitelist.includes((ip || '').replace(/^::ffff:/, ''));
}

module.exports = { currentAdmin, allowedAdminIp };
