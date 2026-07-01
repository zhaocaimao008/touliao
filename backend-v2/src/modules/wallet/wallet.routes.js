'use strict';
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { rechargeLimiter } = require('../../middleware/rateLimiters');
const c = require('./wallet.controller');

router.get('/',             auth, c.balance);                         // 当前余额
router.get('/transactions', auth, c.transactions);                    // 流水（分页）
router.post('/recharge',    auth, rechargeLimiter, c.recharge);       // 充值（占位）

module.exports = router;
