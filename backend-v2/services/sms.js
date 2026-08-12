'use strict';

const config = require('../src/config');
const logger = require('../src/utils/logger');

/**
 * 发送短信 - 支持腾讯云/阿里云
 */
async function send({ phoneNumber, message }) {
  try {
    if (config.sms.provider === 'tencentcloud') {
      return await sendTencentCloud(phoneNumber, message);
    } else if (config.sms.provider === 'aliyun') {
      return await sendAliyun(phoneNumber, message);
    } else {
      throw new Error(`Unknown SMS provider: ${config.sms.provider}`);
    }
  } catch (error) {
    logger.error(`SMS send failed: ${error.message}`);
    throw error;
  }
}

/**
 * 腾讯云短信
 */
async function sendTencentCloud(phoneNumber, message) {
  const tencentcloud = require("tencentcloud-sdk-nodejs");
  const smsClient = new tencentcloud.sms.v20210111.Client({
    credential: {
      secretId: config.sms.secretId,
      secretKey: config.sms.secretKey,
    },
    region: config.sms.region,
  });

  const params = {
    PhoneNumberSet: [phoneNumber],
    SmsSdkAppId: config.sms.sdkAppId,
    SignName: config.sms.signName,
    TemplateId: config.sms.templateId,
    TemplateParamSet: [message],
  };

  const result = await smsClient.SendSms(params);
  logger.info(`SMS sent via TencentCloud: ${result.SendStatusSet[0].MessageId}`);
  return result;
}

/**
 * 阿里云短信
 */
async function sendAliyun(phoneNumber, message) {
  const Dysmsapi = require('@alicloud/dysmsapi20170525');
  const { Client } = Dysmsapi;

  const client = new Client({
    accessKeyId: config.sms.accessKeyId,
    accessKeySecret: config.sms.accessKeySecret,
    endpoint: config.sms.endpoint,
    regionId: config.sms.regionId,
  });

  const result = await client.sendSms({
    phoneNumbers: phoneNumber,
    signName: config.sms.signName,
    templateCode: config.sms.templateCode,
    templateParam: JSON.stringify({ message }),
  });

  logger.info(`SMS sent via Aliyun: ${result.body.bizId}`);
  return result;
}

module.exports = { send };
