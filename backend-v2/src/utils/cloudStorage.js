'use strict';
/**
 * 云存储抽象（Cloudflare R2 / 阿里云 OSS / 腾讯云 COS）。
 * 通过 CLOUD_PROVIDER 选择。客户端直传，文件绝不经过本服务器。
 */
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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

async function getPresignedPutUrl(key, contentType) {
  const { client, bucket, publicBase } = buildConfig();
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: 600 });
  return { uploadUrl, publicUrl: `${publicBase}/${key}` };
}

async function uploadFile(key, buffer, contentType) {
  const { client, bucket, publicBase } = buildConfig();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }));
  return `${publicBase}/${key}`;
}

function getPublicBase() {
  if (!isConfigured()) return null;
  return buildConfig().publicBase;
}

module.exports = { isConfigured, getPresignedPutUrl, uploadFile, getPublicBase };
