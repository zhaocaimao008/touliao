'use strict';

const config = require('../src/config');
const logger = require('../src/utils/logger');

/**
 * 发送钉钉通知
 */
async function send({ userId, message, content }) {
  try {
    const DingTalkSDK = require('dingtalk-sdk');
    
    const client = new DingTalkSDK({
      clientId: config.dingtalk.clientId,
      clientSecret: config.dingtalk.clientSecret,
    });

    const result = await client.robot.sendPrivateMessage({
      conversationId: userId,
      msgtype: 'text',
      text: {
        content: `${message}\n${content}`,
      },
    });

    logger.info(`DingTalk message sent: ${result.taskId}`);
    return result;
  } catch (error) {
    logger.error(`DingTalk send failed: ${error.message}`);
    throw error;
  }
}

module.exports = { send };
