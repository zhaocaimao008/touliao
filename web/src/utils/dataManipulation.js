/**
 * 数据脱敏工具函数
 * 用于前端显示和日志输出时保护敏感信息
 */

/**
 * 手机号脱敏
 * @param {string} phone - 手机号
 * @returns {string} 脱敏后的手机号，如 138****0000
 */
export function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return phone;
  if (phone.length < 11) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

/**
 * 邮箱脱敏
 * @param {string} email - 邮箱地址
 * @returns {string} 脱敏后的邮箱，如 ab***c@example.com
 */
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return email;
  const [local, domain] = email.split('@');
  if (!domain || local.length <= 3) return email;
  return local.slice(0, 2) + '***' + local.slice(-1) + '@' + domain;
}

/**
 * 身份证号脱敏
 * @param {string} idCard - 身份证号
 * @returns {string} 脱敏后的身份证号，如 110101********1234
 */
export function maskIdCard(idCard) {
  if (!idCard || typeof idCard !== 'string') return idCard;
  if (idCard.length < 18) return idCard;
  return idCard.slice(0, 6) + '********' + idCard.slice(-4);
}

/**
 * 银行卡号脱敏
 * @param {string} cardNumber - 银行卡号
 * @returns {string} 脱敏后的卡号，如 6222 **** **** 1234
 */
export function maskBankCard(cardNumber) {
  if (!cardNumber || typeof cardNumber !== 'string') return cardNumber;
  const cleaned = cardNumber.replace(/\s/g, '');
  if (cleaned.length < 16) return cardNumber;
  return cleaned.slice(0, 4) + ' **** **** ' + cleaned.slice(-4);
}

/**
 * 消息内容缩略
 * @param {string} content - 消息内容
 * @param {number} maxLen - 最大长度，默认 20
 * @returns {string} 缩略后的内容
 */
export function maskContent(content, maxLen = 20) {
  if (!content || typeof content !== 'string') return '';
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + '...';
}

/**
 * 地址脱敏（保留省市，隐藏详细地址）
 * @param {string} address - 详细地址
 * @returns {string} 脱敏后的地址，如 北京市朝阳区***
 */
export function maskAddress(address) {
  if (!address || typeof address !== 'string') return address;
  // 简单实现：保留前10个字符
  if (address.length <= 10) return address;
  return address.slice(0, 10) + '***';
}

/**
 * 姓名脱敏
 * @param {string} name - 姓名
 * @returns {string} 脱敏后的姓名，如 张*、欧阳**
 */
export function maskName(name) {
  if (!name || typeof name !== 'string') return name;
  if (name.length === 0) return name;
  if (name.length === 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 1);
}

/**
 * 通用脱敏函数
 * @param {Object} data - 数据对象
 * @param {Array<string>} fields - 需要脱敏的字段名
 * @returns {Object} 脱敏后的数据对象
 */
export function maskData(data, fields = []) {
  if (!data || typeof data !== 'object') return data;
  
  const masked = { ...data };
  const defaultSensitiveFields = ['password', 'token', 'secret', 'key'];
  const allFields = [...new Set([...defaultSensitiveFields, ...fields])];
  
  for (const field of allFields) {
    if (masked[field]) {
      masked[field] = '[REDACTED]';
    }
  }
  
  // 自动识别并脱敏特定字段
  if (masked.phone) masked.phone = maskPhone(masked.phone);
  if (masked.email) masked.email = maskEmail(masked.email);
  if (masked.idCard) masked.idCard = maskIdCard(masked.idCard);
  if (masked.cardNumber) masked.cardNumber = maskBankCard(masked.cardNumber);
  
  return masked;
}

/**
 * 日志安全输出（自动脱敏）
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {Object} data - 附加数据
 */
export function safeLog(level, message, data = {}) {
  const masked = maskData(data);
  console[level] || console.log(`[${level.toUpperCase()}]`, message, masked);
}
