'use strict';
/**
 * R2 bucket CORS 配置脚本（一次性执行）
 * 用法: node scripts/configure-r2-cors.js
 * 依赖: backend-v2/.env 已配置 R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
 *
 * 安全原则：
 * - 仅允许正式 Web Origin（touliao.cc / www.touliao.cc）
 * - 方法仅 PUT/GET/HEAD（实际需要）
 * - Headers 仅 Content-Type（Presigned PUT 实际携带）
 * - 不使用 * 通配 Origin/Header/Method
 */
require('dotenv').config();
const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const {
  R2_ACCOUNT_ID, R2_BUCKET,
  R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('缺少 R2 凭据，请在 .env 配置 R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  forcePathStyle: true,
});

// 额外 Origin（Electron/Capacitor 等真实客户端，按需追加；不允许 *）
const EXTRA_ORIGINS = (process.env.R2_CORS_EXTRA_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const CORS_RULES = [{
  AllowedOrigins: [
    'https://touliao.cc',
    'https://www.touliao.cc',
    ...EXTRA_ORIGINS,
  ],
  AllowedMethods: ['PUT', 'GET', 'HEAD'],
  AllowedHeaders: ['Content-Type'],
  ExposeHeaders: ['ETag'],
  MaxAgeSeconds: 3600,
}];

async function main() {
  const cmd = new PutBucketCorsCommand({ Bucket: R2_BUCKET, CORSConfiguration: { CORSRules: CORS_RULES } });
  const out = await client.send(cmd);
  console.log('CORS 配置成功:', JSON.stringify(CORS_RULES, null, 2));
  console.log('响应:', JSON.stringify(out));
}

main().catch(e => { console.error('CORS 配置失败:', e.message); process.exit(1); });
