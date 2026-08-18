#!/usr/bin/env node
/**
 * r2_verify.js —— 自动设置 R2 桶 CORS + 端到端验证(直传 + 公开读)。
 * 从环境变量读配置(不写死密钥)；Hermes 在服务器上运行：
 *   export $(grep -E '^(R2_|CLOUD_)' /root/投聊/backend-v2/.env | xargs) \
 *     && APP_DIR=/root/投聊/backend-v2 node /root/投聊/ops/r2_verify.js
 */
'use strict';
const path = require('path');
const https = require('https');
const APP = process.env.APP_DIR || '/root/投聊/backend-v2';
const {
  S3Client, PutBucketCorsCommand, GetBucketCorsCommand, PutObjectCommand,
} = require(path.join(APP, 'node_modules/@aws-sdk/client-s3'));

const ACCOUNT = process.env.R2_ACCOUNT_ID;
const BUCKET  = process.env.R2_BUCKET;
const AK      = process.env.R2_ACCESS_KEY_ID;
const SK      = process.env.R2_SECRET_ACCESS_KEY;
const PUBDOM  = process.env.R2_PUBLIC_DOMAIN;
const ORIGINS = ['https://touliao.cc', 'https://www.touliao.cc'];

if (!ACCOUNT || !BUCKET || !AK || !SK) { console.log('❌ 缺少 R2 环境变量'); process.exit(1); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: AK, secretAccessKey: SK },
  forcePathStyle: true,
});

function httpsGet(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    }).on('error', e => resolve({ status: 0, body: e.message }));
  });
}

(async () => {
  console.log(`R2: account=${ACCOUNT} bucket=${BUCKET} 公开域名=${PUBDOM || '(默认 pub-*.r2.dev)'}\n`);

  // 1) 设置 CORS
  try {
    await s3.send(new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: { CORSRules: [{
        AllowedOrigins: ORIGINS, AllowedMethods: ['PUT', 'GET', 'HEAD'],
        AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600,
      }] },
    }));
    const g = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
    console.log('✅ CORS 已设置:', JSON.stringify(g.CORSRules));
  } catch (e) {
    console.log(`❌ CORS 设置失败: ${e.name} ${e.message}`);
    console.log('   (R2 若不支持 S3 PutBucketCors, 需在 Cloudflare 控制台桶 Settings→CORS policy 手动粘贴)');
  }

  // 2) 直传一个测试对象（验证密钥+桶可写）
  const key = `__verify__/r2-ok-${Date.now()}.txt`;
  const content = 'vxin r2 verify ' + Date.now();
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: content, ContentType: 'text/plain' }));
    console.log(`✅ 直传成功: ${key}`);
  } catch (e) {
    console.log(`❌ 直传失败(密钥/桶名/权限问题): ${e.name} ${e.message}`); process.exit(1);
  }

  // 3) 从公开 URL 取回（验证公开读 + 公开域名对不对）
  const base = PUBDOM ? `https://${PUBDOM.replace(/^https?:\/\//, '')}` : `https://pub-${ACCOUNT}.r2.dev`;
  const url = `${base}/${key}`;
  const r = await httpsGet(url);
  if (r.status === 200 && r.body.includes('vxin r2 verify')) {
    console.log(`✅ 公开读成功: ${url}`);
  } else {
    console.log(`❌ 公开读失败 [${r.status}]: ${url}`);
    console.log('   → 多半是桶没开 Public Development URL, 或 R2_PUBLIC_DOMAIN 填错');
  }
  console.log('\n完成。');
})();
