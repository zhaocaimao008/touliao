'use strict';
// Append only. No historical message/body/backup deletion in this migration.
module.exports = [
 "ALTER TABLE scheduled_messages ADD COLUMN delivery_version INTEGER NOT NULL DEFAULT 0",
 `CREATE TABLE IF NOT EXISTS writer_receipts (
   operation_id TEXT PRIMARY KEY, result_json TEXT NOT NULL,
   committed_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
 )`,
 "ALTER TABLE message_forward_batches ADD COLUMN target_results TEXT NOT NULL DEFAULT '[]'",
 "ALTER TABLE messages ADD COLUMN burn_after INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE messages ADD COLUMN burn_read_at INTEGER DEFAULT NULL",
 "ALTER TABLE messages ADD COLUMN burn_expires_at INTEGER DEFAULT NULL",
 "CREATE INDEX IF NOT EXISTS idx_messages_burn_due ON messages(burn_expires_at) WHERE deleted=0 AND burn_expires_at IS NOT NULL",
 `CREATE TABLE IF NOT EXISTS revoked_burn_files (
   path TEXT PRIMARY KEY, message_id TEXT NOT NULL,
   revoked_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
 )`,
 `CREATE TRIGGER IF NOT EXISTS messages_capture_burn_policy AFTER INSERT ON messages
   WHEN NEW.type IN ('text','image','video','voice','file')
   BEGIN
     UPDATE messages SET burn_after=COALESCE((SELECT burn_after FROM conversation_settings
       WHERE user_id=NEW.sender_id AND conversation_id=NEW.conversation_id),0) WHERE id=NEW.id;
   END`,
];
