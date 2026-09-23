'use strict';
// JSON numbers or decimal integer strings only. Never truncate user input.
module.exports = function strictInteger(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return NaN;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : NaN;
};
