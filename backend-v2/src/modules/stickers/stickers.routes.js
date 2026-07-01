'use strict';
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { stickerLimiter } = require('../../middleware/rateLimiters');
const c = require('./stickers.controller');

router.get('/',          auth, c.list);
router.post('/upload',   auth, stickerLimiter, ...c.uploadMiddlewares, c.uploadHandle);
router.post('/collect',  auth, stickerLimiter, c.collect);
router.post('/send',     auth, stickerLimiter, c.send);
router.delete('/:id',    auth, c.remove);

module.exports = router;
