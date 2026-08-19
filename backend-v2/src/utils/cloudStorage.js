'use strict';
/**
 * 云存储抽象（Cloudflare R2 / 阿里云 OSS / 腾讯云 COS）。
 * 通过 CLOUD_PROVIDER 选择。客户端直传，文件绝不经过本服务器。
 */
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl }               = require('@aws-sdk/s3-request-presigner');

const PROVIDER = (process.env.CLOUD_PROVIDER || '').toLowerCase();

function isConfigured() {
  if (PROVIDER === 'r2') {
    return !!(process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET &&
              process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
  }
  if (PROVIDER === 'aliyun') {
    return !!(process.env.OSS_REGION && process.env.OSS_BUCKET &&
              process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET);
  }
  if (PROVIDER === 'tencent') {
    return !!(process.env.COS_REGION && process.env.COS_BUCKET &&
              process.env.COS_SECRET_ID && process.env.COS_SECRET_KEY);
  }
  return false;
}

function buildConfig() {
  if (PROVIDER === 'r2') {
    const accountId = process.env.R2_ACCOUNT_ID;
    return {
      client: new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId:     process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
      }),
      bucket: process.env.R2_BUCKET,
      publicBase: process.env.R2_PUBLIC_DOMAIN
        ? `https://${process.env.R2_PUBLIC_DOMAIN}`
        : `https://pub-${accountId}.r2.dev`,
    };
  }
  if (PROVIDER === 'tencent') {
    const bucket = process.env.COS_BUCKET, region = process.env.COS_REGION;
    return {
      client: new S3Client({
        region,
        endpoint: `https://cos.${region}.myqcloud.com`,
        credentials: { accessKeyId: process.env.COS_SECRET_ID, secretAccessKey: process.env.COS_SECRET_KEY },
        forcePathStyle: false,
      }),
      bucket,
      publicBase: process.env.COS_CDN_DOMAIN
        ? `https://${process.env.COS_CDN_DOMAIN}`
        : `https://${bucket}.cos.${region}.myqcloud.com`,
    };
  }
  const bucket = process.env.OSS_BUCKET, region = process.env.OSS_REGION;
  return {
    client: new S3Client({
      region,
      endpoint: `https://oss-${region}.aliyuncs.com`,
      credentials: { accessKeyId: process.env.OSS_ACCESS_KEY_ID, secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET },
      forcePathStyle: false,
    }),
    bucket,
    publicBase: process.env.OSS_CDN_DOMAIN
      ? `https://${process.env.OSS_CDN_DOMAIN}`
      : `https://${bucket}.oss-${region}.aliyuncs.com`,
  };
}

let _cfg = null;
function getConfig() {
  if (!_cfg) _cfg = buildConfig();
  return _cfg;
}

async function getPresignedPutUrl(key, contentType) {
  if (!isConfigured()) throw new Error('云存储未配置，请先设置 CLOUD_PROVIDER 及对应环境变量');
  const { client, bucket } = getConfig();
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: 600 });
  // 上传凭证只暴露短时 PUT URL；公开访问地址一律不给（Private bucket，下载走权限校验后的 302 跳转）。
  return { uploadUrl, publicUrl: '' };
}

/**
 * 生成短时 GET 预签名 URL（默认 600s）。
 * 仅允许在服务端完成 file_registry 权限校验后调用；预签名 URL 在有效期内是 bearer capability，
 * 不得写入日志、不得持久化存储。
 * @param {string} key R2 对象 key
 * @param {number} [expiresIn=600] 秒
 */
async function getPresignedGetUrl(key, expiresIn = 600) {
  if (!isConfigured()) throw new Error('云存储未配置，请先设置 CLOUD_PROVIDER 及对应环境变量');
  const { client, bucket } = getConfig();
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, cmd, { expiresIn });
}

async function uploadFile(key, buffer, contentType) {
  if (!isConfigured()) throw new Error('云存储未配置，请先设置 CLOUD_PROVIDER 及对应环境变量');
  const { client, bucket, publicBase } = getConfig();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }));
  return `${publicBase}/${key}`;
}

function getPublicBase() {
  if (!isConfigured()) return null;
  return getConfig().publicBase;
}

module.exports = { isConfigured, getPresignedPutUrl, getPresignedGetUrl, uploadFile, getPublicBase };
