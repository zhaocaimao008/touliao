'use strict';
const router = require('express').Router();
const auth = require('../../middleware/auth');
const c = require('./friend_labels.controller');

router.get   ('/',                    auth, c.list);
router.post  ('/',                    auth, c.create);
router.put   ('/:id',                 auth, c.update);
router.delete('/:id',                 auth, c.remove);
router.post  ('/:id/members',         auth, c.addMember);
router.delete('/:id/members/:friendId', auth, c.removeMember);

module.exports = router;
