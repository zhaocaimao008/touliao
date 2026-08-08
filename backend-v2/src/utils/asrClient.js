'use strict';
/**
 * ASR（语音转文字）客户端 —— 调用独立部署的 faster-whisper HTTP 服务。
 *
 * 设计要点：
 *   - 真实转写：仅转发音频给真实 ASR 引擎，绝不返回假数据；服务不可用/超时一律抛错，
 *     由上层转成 503，前端提示「转写服务暂不可用」。
 *   - 超时：用 AbortController 控制单请求超时（默认 30s，config.asr.timeoutMs）。
 *   - 依赖 Node 18+ 内置 fetch / FormData / Blob（本项目 Node 22）。
 */
const config = require('../config');

// ASR 服务不可用（连不上/超时/非 2xx）时抛出的专用错误，携带 asrUnavailable 标记。
class AsrUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AsrUnavailableError';
    this.asrUnavailable = true;
  }
}

// 健康检查：GET /health。返回 true/false，不抛错（供诊断用）。
async function health() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`${config.asr.baseUrl}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return false;
    const json = await resp.json();
    return !!json.ok;
  } catch {
    return false;
  }
}

/**
 * 转写音频 Buffer。
 * @param {Buffer} buf       音频原始字节
 * @param {string} filename  文件名（带扩展名，供服务端识别容器格式，如 voice.webm）
 * @param {string} language  语言（'auto' 自动检测；中文可传 'zh'）
 * @returns {Promise<{text:string, language:string, duration:number}>}
 * @throws  {AsrUnavailableError} 服务连不上/超时/5xx；或转写引擎错误
 */
async function transcribe(buf, filename = 'audio.webm', language = 'auto') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.asr.timeoutMs);
  try {
    const form = new FormData();
    // Blob 承载二进制；类型交给服务端 ffmpeg 探测，这里给通用值即可
    form.append('file', new Blob([buf]), filename);
    form.append('language', language || 'auto');

    const resp = await fetch(`${config.asr.baseUrl}/transcribe`, {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
    });

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try { const j = await resp.json(); if (j.detail) detail = j.detail; } catch { /* 忽略解析失败 */ }
      // 5xx / 503：服务或引擎不可用 → 抛可辨识错误；4xx（如空文件）也归为不可用交由上层 503 兜底
      throw new AsrUnavailableError(`ASR 服务返回错误: ${detail}`);
    }

    const json = await resp.json();
    return {
      text: (json.text || '').trim(),
      language: json.language || language,
      duration: json.duration || 0,
    };
  } catch (e) {
    if (e instanceof AsrUnavailableError) throw e;
    // AbortError（超时）或网络错误（ECONNREFUSED 等）统一归为服务不可用
    const reason = e.name === 'AbortError' ? '转写超时' : (e.message || '无法连接 ASR 服务');
    throw new AsrUnavailableError(reason);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { transcribe, health, AsrUnavailableError };
