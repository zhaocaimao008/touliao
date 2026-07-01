'use strict';
/**
 * 数据库入口（供 require('./db') 解析）
 * 将 connection.js 的 db（better-sqlite3 实例）暴露为默认导出，
 * 使 app.js 中的 require('./db').prepare 可以正常工作。
 */
const { db, readDb, generateGroupNumber, generateVxinId } = require('./connection');
module.exports = db;
