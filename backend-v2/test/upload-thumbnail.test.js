'use strict';
/**
 * 图片上传后的缩略图生成（性能审计发现：头像/聊天图/朋友圈九宫格不管显示多小都拉全尺寸
 * 原图，2026-09-03 加）。generateThumbnail() 在原图旁生成 <uuid>_thumb.webp，命名约定
 * 供前端从原图 URL 纯字符串推导，onError 回退原图——不改 DB schema、不改消息负载。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { generateThumbnail } = require('../src/utils/upload');

function tmpPath(name) {
  return path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

async function makeJpeg(width, height) {
  const buf = await sharp({ create: { width, height, channels: 3, background: 'red' } }).jpeg().toBuffer();
  const p = tmpPath('thumb-test') + '.jpg';
  fs.writeFileSync(p, buf);
  return p;
}

function thumbPathFor(originalPath) {
  const dir = path.dirname(originalPath);
  const base = path.basename(originalPath, path.extname(originalPath));
  return path.join(dir, `${base}_thumb.webp`);
}

describe('图片上传缩略图生成', () => {
  test('JPEG：原图旁生成 <uuid>_thumb.webp，尺寸不超过 maxDim', async () => {
    const p = await makeJpeg(1200, 800);
    const thumb = thumbPathFor(p);
    try {
      await generateThumbnail(p, 'image/jpeg', 400);
      expect(fs.existsSync(thumb)).toBe(true);
      const meta = await sharp(thumb).metadata();
      expect(meta.format).toBe('webp');
      // 1200x800 长边 1200 缩到 400：宽 400，高按比例 267
      expect(meta.width).toBe(400);
      expect(meta.height).toBeLessThanOrEqual(400);
      expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(400);
    } finally {
      fs.unlinkSync(p);
      if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
    }
  });

  test('小图（本就小于 maxDim）不被放大：withoutEnlargement', async () => {
    const p = await makeJpeg(100, 60);
    const thumb = thumbPathFor(p);
    try {
      await generateThumbnail(p, 'image/jpeg', 400);
      const meta = await sharp(thumb).metadata();
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(60);
    } finally {
      fs.unlinkSync(p);
      if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
    }
  });

  test('maxDim 480（聊天图片口径）：长边不超过 480', async () => {
    const p = await makeJpeg(2000, 1000);
    const thumb = thumbPathFor(p);
    try {
      await generateThumbnail(p, 'image/jpeg', 480);
      const meta = await sharp(thumb).metadata();
      expect(meta.width).toBe(480);
    } finally {
      fs.unlinkSync(p);
      if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
    }
  });

  test('GIF 不生成缩略图（多帧动画，与 EXIF 剥离同口径跳过）', async () => {
    const gifBuf = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'blue' } }).gif().toBuffer();
    const p = tmpPath('thumb-gif') + '.gif';
    fs.writeFileSync(p, gifBuf);
    const thumb = thumbPathFor(p);
    try {
      await generateThumbnail(p, 'image/gif', 400);
      expect(fs.existsSync(thumb)).toBe(false);
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('非图片 MIME 直接跳过', async () => {
    const p = tmpPath('thumb-pdf') + '.pdf';
    fs.writeFileSync(p, Buffer.from('%PDF-1.4 fake content'));
    const thumb = thumbPathFor(p);
    try {
      await generateThumbnail(p, 'application/pdf', 400);
      expect(fs.existsSync(thumb)).toBe(false);
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('fail-open：损坏的图片文件不抛异常、不生成缩略图', async () => {
    const p = tmpPath('thumb-corrupt') + '.jpg';
    fs.writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]));
    const thumb = thumbPathFor(p);
    try {
      await expect(generateThumbnail(p, 'image/jpeg', 400)).resolves.toBeUndefined();
      expect(fs.existsSync(thumb)).toBe(false);
    } finally {
      fs.unlinkSync(p);
    }
  });
});
