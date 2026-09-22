'use strict';
const { createHash } = require('crypto');
const { db } = require('../../db/connection');
const { badRequest, conflict } = require('../../utils/http');

// The result, ledger and business rows commit together. BEGIN IMMEDIATE serializes
// competing processes before reading the key, so neither can perform a second debit.
// No TTL: expiring a successful key would allow a delayed retry to debit again.
function runFinancialOperation(actorId, operation, key, payload, apply) {
  if (key != null && (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key))) {
    throw badRequest('Idempotency-Key 格式无效', 'INVALID_IDEMPOTENCY_KEY');
  }
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return db.transaction(() => {
    if (key != null) {
      const existing = db.prepare(`SELECT request_hash,response_json FROM financial_idempotency
        WHERE actor_id=? AND operation=? AND idempotency_key=?`).get(actorId, operation, key);
      if (existing) {
        if (existing.request_hash !== hash) throw conflict('同一请求标识不能用于不同操作内容', 'IDEMPOTENCY_CONFLICT');
        return { result: JSON.parse(existing.response_json), replayed: true };
      }
    }
    const result = apply();
    if (key != null) db.prepare(`INSERT INTO financial_idempotency
      (actor_id,operation,idempotency_key,request_hash,response_json) VALUES (?,?,?,?,?)`)
      .run(actorId, operation, key, hash, JSON.stringify(result));
    return { result, replayed: false };
  }).immediate();
}
module.exports = { runFinancialOperation };
