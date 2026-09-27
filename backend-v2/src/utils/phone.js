'use strict';
// 手机号规范化：去掉空格/横线/括号与开头的 +，+86/86 开头的 13 位号码折算为 11 位大陆号码。
// 客户端自动填充常带格式（iOS textContentType=.telephoneNumber → "+86 138 1234 5678"）；
// 注册/换绑按规范化后的值存储与判重，登录/搜索兼容历史上带格式存储的号码。
function normalizePhone(phone) {
  const digits = String(phone).replace(/[\s\-()]/g, '').replace(/^\+/, '');
  return /^86\d{11}$/.test(digits) ? digits.slice(2) : digits;
}

module.exports = { normalizePhone };
