'use strict';
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const config = require('../../config');
const { asyncHandler, badRequest, notFound, forbidden } = require('../../utils/http');
const { makeImageUploader } = require('../../utils/upload');
const { isMember } = require('../messages/shared');
const msgSvc = require('../messages/messages.service');
const { getPublicBase } = require('../../utils/cloudStorage');

const io = req => req.app.get('io');
const STICKERS_DIR = path.join(config.uploadsRoot, 'stickers');
const stickerUploader = makeImageUploader(STICKERS_DIR, 'image', 1, 5 * 1024 * 1024);
const MAX_STICKERS = 200;

function countOf(userId) {
  return db.prepare('SELECT COUNT(*) n FROM user_stickers WHERE user_id=?').get(userId).n;
}

// 我的表情列表
exports.list = asyncHandler(async (req, res) => {
  res.json(db.prepare('SELECT id, url, created_at FROM user_stickers WHERE user_id=? ORDER BY created_at DESC').all(req.user.id));
});

// 上传图片新增表情
exports.uploadMiddlewares = stickerUploader;
exports.uploadHandle = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('请选择图片');
  const url = `/uploads/stickers/${req.file.filename}`;
  const id = uuidv4();
  db.transaction(() => {
    if (countOf(req.user.id) >= MAX_STICKERS) throw badRequest(`表情已达上限 ${MAX_STICKERS} 个`);
    db.prepare('INSERT INTO user_stickers (id,user_id,url) VALUES (?,?,?)').run(id, req.user.id, url);
  })();
  res.json({ id, url });
});

// 收藏：把一张已有图片(本站/云存储)存为表情
exports.collect = asyncHandler(async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') throw badRequest('参数缺失');
  const pub = getPublicBase();
  const ok = url.startsWith('/uploads/') || (pub && url.startsWith(pub + '/'));
  if (!ok) throw badRequest('图片来源不合法');
  if (db.prepare('SELECT 1 FROM user_stickers WHERE user_id=? AND url=?').get(req.user.id, url)) {
    return res.json({ success: true, already: true });
  }
  const id = uuidv4();
  db.transaction(() => {
    if (countOf(req.user.id) >= MAX_STICKERS) throw badRequest(`表情已达上限 ${MAX_STICKERS} 个`);
    db.prepare('INSERT INTO user_stickers (id,user_id,url) VALUES (?,?,?)').run(id, req.user.id, url);
  })();
  res.json({ id, url });
});

// 删除表情
exports.remove = asyncHandler(async (req, res) => {
  const r = db.prepare('DELETE FROM user_stickers WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (r.changes === 0) throw notFound('表情不存在');
  res.json({ success: true });
});

// 发送表情：创建一条 image 消息并广播(复用已有上传消息逻辑)
exports.send = asyncHandler(async (req, res) => {
  const { conversationId, stickerId } = req.body || {};
  if (!conversationId || !stickerId) throw badRequest('参数缺失');
  if (!isMember(conversationId, req.user.id)) throw forbidden('无权发送');
  const sticker = db.prepare('SELECT url FROM user_stickers WHERE id=? AND user_id=?').get(stickerId, req.user.id);
  if (!sticker) throw notFound('表情不存在');
  const msg = await msgSvc.saveUploadedFile(io(req), conversationId, req.user.id, {
    type: 'image', content: '[表情]', fileUrl: sticker.url,
  });
  res.json(msg);
});
