'use strict';
// Synthetic media that already existed before visual uploads were suspended.
// Seed disk + ownership + optional message together; do not bypass upload policy.
require('../testEnv');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { db } = require('../../src/db/connection');
const config = require('../../src/config');
const { TEST_UPLOADS } = require('../testEnv');
const files = new Set();

function seedLegacyMedia({ ownerId, conversationId = '', kind = 'files', filename, mime, bytes, thumbnail }) {
  assert.equal(config.uploadsRoot, TEST_UPLOADS);
  assert.ok(['files', 'moments', 'stickers'].includes(kind));
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0);
  const id = randomUUID();
  const url = `/uploads/${kind}/${id}${path.extname(filename)}`;
  const diskPath = path.join(TEST_UPLOADS, kind, path.basename(url));
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  const write = (filePath, content, fileUrl) => {
    fs.writeFileSync(filePath, content);
    files.add(filePath);
    db.prepare('INSERT INTO file_registry(path, owner_id, conversation_id, kind) VALUES (?,?,?,?)')
      .run(fileUrl, ownerId, conversationId, kind);
  };
  write(diskPath, bytes, url);
  if (thumbnail) {
    const thumbUrl = url.replace(/\.[^.]+$/, '_thumb.webp');
    write(path.join(TEST_UPLOADS, kind, path.basename(thumbUrl)), thumbnail, thumbUrl);
  }
  let message;
  if (kind === 'files' && conversationId) {
    const type = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
    db.prepare(`INSERT INTO messages
      (id, conversation_id, sender_id, type, content, file_url, file_mime, file_size)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, conversationId, ownerId, type, filename, url, mime, bytes.length);
    message = db.prepare('SELECT * FROM messages WHERE id=?').get(id);
  }
  assert.ok(fs.existsSync(diskPath));
  assert.equal(db.prepare('SELECT owner_id FROM file_registry WHERE path=?').get(url).owner_id, ownerId);
  return { url, path: diskPath, message };
}

function cleanupLegacyMedia() {
  for (const filePath of files) fs.rmSync(filePath, { force: true });
  files.clear();
}

module.exports = { seedLegacyMedia, cleanupLegacyMedia };
