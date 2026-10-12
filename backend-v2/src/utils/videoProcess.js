'use strict';
// 视频上传后处理（2026-10-12）：
//   1) faststart：mp4/mov/m4v 的 moov atom 挪到文件头（-c copy 纯重封装，不转码，秒级），
//      播放器无需先下载到文件尾就能起播/拖动。失败保留原文件。
//   2) 封面帧：在原视频旁生成 <uuid>_thumb.webp，与图片缩略图同一命名约定
//      （见 utils/upload.js generateThumbnail、web/src/utils/url.js getThumbUrl），
//      调用方用 thumbUrlIfExists 判断是否生成并登记 file_registry。
//   3) ffprobe 读取 width/height/duration（目前只有 duration 有现成字段可用）。
// 全部 fail-open：ffmpeg 不存在/超时/报错只打 warn，绝不挡住上传本身。
// 通过 execFile 直接调用（无 shell），带超时，最小化环境变量。
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const sharp = require('sharp');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
// FFPROBE_PATH 未配时：若 FFMPEG_PATH 是绝对路径，取同目录 ffprobe；否则走 PATH。
const FFPROBE = process.env.FFPROBE_PATH
  || (path.isAbsolute(FFMPEG) ? path.join(path.dirname(FFMPEG), 'ffprobe') : 'ffprobe');
const FASTSTART_EXTS = new Set(['.mp4', '.mov', '.m4v']);
const EXEC_ENV = { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8' };
const POSTER_MAX_W = 480;

function run(bin, args, { timeout = 30000, encoding = 'utf8', maxBuffer = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, killSignal: 'SIGKILL', encoding, maxBuffer, env: EXEC_ENV, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr || '').trim().split('\n').slice(-2).join(' | ');
          // Node 的 err.message 已含完整 stderr，这里只保留 stderr 末两行，避免日志刷屏
          err.message = `${path.basename(bin)} 失败: ${err.killed ? '超时' : (tail || String(err.message).split('\n')[0])}`;
          return reject(err);
        }
        resolve(stdout);
      });
  });
}

// ffmpeg 不可用（ENOENT）时记一次，之后不再反复 spawn 失败刷日志
let ffmpegMissing = false;
function noteError(what, err) {
  if (err && err.code === 'ENOENT') {
    if (!ffmpegMissing) console.warn(`[video] 未找到 ffmpeg/ffprobe（FFMPEG_PATH=${FFMPEG}），跳过视频后处理`);
    ffmpegMissing = true;
    return;
  }
  console.warn(`[video] ${what}失败，跳过（不影响原视频）:`, err && err.message);
}

/** 原地 faststart 重封装：成功返回 true（文件已被原子替换），否则 false 且原文件不动。 */
async function faststartInPlace(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ffmpegMissing || !FASTSTART_EXTS.has(ext)) return false;
  // 临时文件放同目录（保证 rename 原子、不跨文件系统），点开头 + 不在 file_registry，不会被对外提供
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath, ext)}.faststart${ext}`);
  try {
    await run(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', filePath,
      '-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', tmp], { timeout: 60000 });
    const st = await fs.promises.stat(tmp);
    if (!st.size) throw new Error('输出为空');
    await fs.promises.rename(tmp, filePath);
    return true;
  } catch (err) {
    fs.promises.unlink(tmp).catch(() => {});
    noteError('faststart 重封装', err);
    return false;
  }
}

/** ffprobe 读取首个视频流宽高（按旋转角交换为显示尺寸）与时长（秒，浮点）。失败返回 null。 */
async function probeVideo(filePath) {
  if (ffmpegMissing) return null;
  try {
    const out = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:stream_tags=rotate:stream_side_data=rotation:format=duration',
      '-of', 'json', filePath], { timeout: 15000 });
    const j = JSON.parse(out);
    const s = (j.streams && j.streams[0]) || {};
    let width = Number(s.width) || 0, height = Number(s.height) || 0;
    const sd = (s.side_data_list || []).find(d => d.rotation !== undefined);
    const rot = Math.abs(Number(sd ? sd.rotation : (s.tags && s.tags.rotate)) || 0) % 180;
    if (rot === 90) [width, height] = [height, width];
    const duration = Number(j.format && j.format.duration);
    return { width, height, duration: Number.isFinite(duration) && duration > 0 ? duration : 0 };
  } catch (err) {
    noteError('ffprobe', err);
    return null;
  }
}

/**
 * 截取一帧生成 <uuid>_thumb.webp（宽 ≤480，等比）。先 -ss 0.5（跳过常见的首帧黑屏），
 * 极短视频 0.5s 处无帧时回退 -ss 0。ffmpeg 输出 PNG 到管道，再交给 sharp 编码 WebP，
 * 与图片缩略图同一编码参数，也不依赖 ffmpeg 是否编译了 libwebp。
 */
async function generateVideoPoster(filePath) {
  if (ffmpegMissing) return false;
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const thumbPath = path.join(dir, `${base}_thumb.webp`);
  const grab = ss => run(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-ss', ss, '-i', filePath,
    '-frames:v', '1', '-vf', `scale='min(${POSTER_MAX_W},iw)':-2`, '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'],
    { timeout: 20000, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  try {
    let png = await grab('0.5').catch(err => { if (err.code === 'ENOENT') throw err; return null; });
    if (!png || !png.length) png = await grab('0');
    if (!png || !png.length) throw new Error('未截到视频帧');
    await sharp(png).webp({ quality: 78 }).toFile(thumbPath);
    return true;
  } catch (err) {
    fs.promises.unlink(thumbPath).catch(() => {});
    noteError('视频封面生成', err);
    return false;
  }
}

/**
 * 上传完成后的一站式处理：faststart（先做，封面/探测读的是最终文件）→ 并行 ffprobe + 封面。
 * 返回 { size, width, height, duration }（size 为处理后的真实字节数；探测失败的字段为 0）。
 * 永不抛错。
 */
async function processUploadedVideo(filePath) {
  const result = { size: 0, width: 0, height: 0, duration: 0 };
  try {
    await faststartInPlace(filePath);
    const [meta] = await Promise.all([probeVideo(filePath), generateVideoPoster(filePath)]);
    if (meta) Object.assign(result, meta);
    result.size = (await fs.promises.stat(filePath)).size;
  } catch (err) {
    noteError('视频后处理', err);
  }
  return result;
}

module.exports = { processUploadedVideo, faststartInPlace, probeVideo, generateVideoPoster, FFMPEG, FFPROBE };
