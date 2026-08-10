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

  const primaryDisplay = screen.getPrimaryDisplay();
  // 关键修复：用整屏 size（含任务栏区域），而非 workAreaSize；
  // 并按 scaleFactor 还原到物理像素分辨率。旧写法用逻辑像素（workAreaSize）
  // 请求缩略图，在 125%/150% 等缩放的 Windows 高分屏上会被下采样 → 截图发虚/发糊。
  const { width: logicalW, height: logicalH } = primaryDisplay.size;
  const scale = primaryDisplay.scaleFactor || 1;
  const width = Math.round(logicalW * scale);
  const height = Math.round(logicalH * scale);

  // 获取屏幕源（缩略图尺寸给到物理分辨率，拿到清晰全屏图）
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });

  if (!sources || sources.length === 0) {
    throw new Error('无法获取屏幕源');
  }

  // 优先匹配主屏：display_id 与主屏一致最可靠；否则回退英文/中文名，再退第一个源
  const primaryId = String(primaryDisplay.id);
  const source =
    sources.find(s => String(s.display_id) === primaryId) ||
    sources.find(s => s.name.includes('Entire Screen') || s.name.includes('整个屏幕')) ||
    sources[0];

  if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
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
