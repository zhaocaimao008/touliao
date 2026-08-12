'use strict';

const config = require('../src/config');
const logger = require('../src/utils/logger');
const axios = require('axios');

/**
 * 发送企业微信通知
 */
async function send({ toUser, msgtype, text }) {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.post(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`,
      {
        touser: toUser,
        msgtype,
        text,
        agentid: config.wechatWork.agentId,
      }
    );

    logger.info(`WeChat Work message sent: ${response.data.msgid}`);
    return response.data;
  } catch (error) {
    logger.error(`WeChat Work send failed: ${error.message}`);
    throw error;
  }
}

/**
 * 获取访问令牌
 */
async function getAccessToken() {
  const response = await axios.get(
    'https://qyapi.weixin.qq.com/cgi-bin/gettoken',
    {
      params: {
        corpid: config.wechatWork.corpId,
        corpsecret: config.wechatWork.corpSecret,
      },
    }
  );
  
  return response.data.access_token;
}

module.exports = { send };
