'use strict';

const { desktopCapturer, screen, app } = require('electron');
const path = require('path');
const fs = require('fs');

async function createCapturer() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // 获取屏幕源
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });

  if (!sources || sources.length === 0) {
    throw new Error('无法获取屏幕源');
  }

  // 使用主屏幕
  const source = sources.find(s =>
    s.name.includes('Entire Screen') || s.name.includes('整个屏幕')
  ) || sources[0];

  if (!source || !source.thumbnail) {
    throw new Error('截图为空');
  }

  // 保存为临时文件
  const tmpDir = app.getPath('temp');
  const filename = `vxin-screenshot-${Date.now()}.png`;
  const filePath = path.join(tmpDir, filename);

  // desktopCapturer 返回的是 NativeImage，可直接写 PNG
  const pngData = source.thumbnail.toPNG();
  fs.writeFileSync(filePath, pngData);

  return filePath;
}

module.exports = { createCapturer };
