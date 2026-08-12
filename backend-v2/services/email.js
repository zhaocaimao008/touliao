'use strict';

const nodemailer = require('nodemailer');
const config = require('../src/config');
const logger = require('../src/utils/logger');

// 初始化邮件发送器
const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure,
  auth: {
    user: config.email.user,
    pass: config.email.password,
  },
});

/**
 * 发送邮件
 */
async function send({ to, subject, html }) {
  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to,
      subject,
      html,
    });
    
    logger.info(`Email sent: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error(`Email send failed: ${error.message}`);
    throw error;
  }
}

module.exports = { send };
