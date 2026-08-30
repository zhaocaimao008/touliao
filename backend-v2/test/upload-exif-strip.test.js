'use strict';
/**
 * 图片上传后的 EXIF/GPS 元数据剥离（见 AUDIT.md 十节"上传文件校验"🟡）。
 * 头像/聊天图片/朋友圈图片此前原样存储原样下发，手机拍照嵌入的 GPS 坐标会原样暴露给
 * 有权限查看该图片的人。stripImageMetadata() 用 sharp 重新编码：.rotate() 先按 EXIF
 * Orientation 摆正像素，再不带 withMetadata() 落盘，天然清空所有元数据（含 GPS）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { stripImageMetadata } = require('../src/utils/upload');

/** 造一张带 GPS EXIF 的测试 JPEG，返回临时文件路径。 */
async function makeJpegWithGps() {
  const buf = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TouliaoTestCam' },
      GPS: {
        GPSLatitudeRef: 'N', GPSLatitude: '40/1 26/1 46/1',
        GPSLongitudeRef: 'W', GPSLongitude: '79/1 58/1 56/1',
      },
    })
    .toBuffer();
  const p = path.join(os.tmpdir(), `exif-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  fs.writeFileSync(p, buf);
  return p;
}

describe('图片上传 EXIF/GPS 剥离', () => {
  test('JPEG：处理前确认带 GPS，处理后 EXIF 完全清空', async () => {
    const p = await makeJpegWithGps();
    try {
      const before = await sharp(p).metadata();
      expect(before.exif).toBeTruthy(); // 先确认 fixture 真的带 EXIF，不是空跑一遍

      await stripImageMetadata(p, 'image/jpeg');

      const after = await sharp(p).metadata();
      expect(after.exif).toBeUndefined();
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('画面内容不受影响：像素尺寸/内容在剥离前后一致（仅元数据被清）', async () => {
    const p = await makeJpegWithGps();
    try {
      const beforePixels = await sharp(p).raw().toBuffer();
      await stripImageMetadata(p, 'image/jpeg');
      const afterMeta = await sharp(p).metadata();
      const afterPixels = await sharp(p).raw().toBuffer();
      expect(afterMeta.width).toBe(20);
      expect(afterMeta.height).toBe(10);
      expect(Buffer.compare(beforePixels, afterPixels)).toBe(0); // 无旋转时像素应逐字节一致
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('非图片 MIME（如 PDF/视频）直接跳过，不touch文件', async () => {
    const p = path.join(os.tmpdir(), `not-an-image-${Date.now()}.pdf`);
    fs.writeFileSync(p, Buffer.from('%PDF-1.4 fake content for test'));
    const before = fs.readFileSync(p);
    try {
      await stripImageMetadata(p, 'application/pdf');
      const after = fs.readFileSync(p);
      expect(Buffer.compare(before, after)).toBe(0); // 完全没被动过
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('GIF 不做 EXIF 剥离（多帧动画，避免丢帧）', async () => {
    const gifBuf = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'blue' } })
      .gif()
      .toBuffer();
    const p = path.join(os.tmpdir(), `test-${Date.now()}.gif`);
    fs.writeFileSync(p, gifBuf);
    const before = fs.readFileSync(p);
    try {
      await stripImageMetadata(p, 'image/gif');
      const after = fs.readFileSync(p);
      expect(Buffer.compare(before, after)).toBe(0);
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('fail-open：损坏的图片文件不抛异常、不阻塞调用方', async () => {
    const p = path.join(os.tmpdir(), `corrupt-${Date.now()}.jpg`);
    fs.writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])); // 不完整的 JPEG 头
    try {
      // 不 throw、也不 reject——fail-open 靠 try/catch 内部吞掉重编码失败，只记警告
      await expect(stripImageMetadata(p, 'image/jpeg')).resolves.toBeUndefined();
    } finally {
      fs.unlinkSync(p);
    }
  });
});
