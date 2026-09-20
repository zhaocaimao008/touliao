'use strict';
const { db } = require('../../db/connection');
const { badRequest } = require('../../utils/http');
const { version } = require('./documents');
function requireConsent(value) {
  if (value?.accepted !== true || value.privacyVersion !== version || value.termsVersion !== version) {
    throw badRequest('请阅读并勾选同意当前隐私政策和用户协议后继续', 'LEGAL_CONSENT_REQUIRED');
  }
}
function recordConsent(userId) {
  db.prepare(`INSERT INTO legal_consents(user_id,privacy_version,terms_version) VALUES (?,?,?)
    ON CONFLICT(user_id,privacy_version,terms_version) DO NOTHING`).run(userId,version,version);
}
module.exports = { requireConsent, recordConsent };
