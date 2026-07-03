'use strict';

const { desktopCapturer, screen, app } = require('electron');
const path = require('path');
const fs = require('fs');

// 清理本应用遗留的旧截图临时文件，避免 temp 目录长期累积（每次截图前尽力清理，
// 失败不影响主流程）。只匹配本应用命名规则 vxin-screenshot-<ts>.png。
function cleanupOldScreenshots() {
  try {
    const tmpDir = app.getPath('temp');
    const now = Date.now();
    for (const name of fs.readdirSync(tmpDir)) {
      const m = /^vxin-screenshot-(\d+)\.png$/.exec(name);
      if (!m) continue;
      // 保留最近 60s 内的（可能正被读取），其余删除
      if (now - Number(m[1]) > 60 * 1000) {
        try { fs.unlinkSync(path.join(tmpDir, name)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

async function createCapturer() {
  cleanupOldScreenshots();

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
