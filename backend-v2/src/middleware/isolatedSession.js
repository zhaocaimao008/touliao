'use strict';
const config = require('../config');

// Explicit isolated clients must neither read nor replace the shared login cookies.
module.exports = function isolatedSession(req, res, next) {
  if (req.headers['x-touliao-session'] !== 'isolated') return next();
  res.setHeader('X-Touliao-Session', 'isolated');
  const names = new Set([config.cookieName, config.csrfCookie, config.walletCookie]);
  req.cookies = { ...req.cookies };
  for (const name of names) delete req.cookies[name];
  for (const method of ['cookie', 'clearCookie']) {
    const original = res[method].bind(res);
    res[method] = (name, ...args) => names.has(name) ? res : original(name, ...args);
  }
  next();
};
