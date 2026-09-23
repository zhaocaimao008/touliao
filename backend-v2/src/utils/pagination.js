'use strict';
const { badRequest } = require('./http');

function integer(value, name, min) {
  // Query arrays/objects, partial numbers, and unsafe integers must not reach SQL.
  if ((typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) ||
      !Number.isSafeInteger(Number(value)) || Number(value) < min) {
    throw badRequest(`${name} 必须是${min === 0 ? '非负' : '正'}整数`);
  }
  return Number(value);
}

function pagination({ limit = 20, offset = 0 } = {}, maxLimit = 50) {
  return {
    limit: Math.min(integer(limit, 'limit', 1), maxLimit),
    offset: integer(offset, 'offset', 0),
  };
}

module.exports = { pagination };
