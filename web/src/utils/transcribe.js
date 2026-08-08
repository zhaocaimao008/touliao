// 语音转文字：调后端 POST /api/messages/:msgId/transcribe。
// 真实转写由后端的独立 faster-whisper 服务完成；此处仅负责发起请求与规整错误。
// 服务不可用时后端返回 503，这里抛出带 friendly 文案的错误，交由 UI toast 提示，绝不伪造文本。
import axios from 'axios';

/**
 * 发起转写请求。
 * @param {string} msgId 语音消息 id
 * @returns {Promise<{text:string, cached:boolean}>}
 * @throws {Error} err.message 为可直接展示的中文错误文案；err.status 为 HTTP 状态码
 */
export async function transcribeVoice(msgId) {
  if (!msgId) throw new Error('缺少消息标识');
  try {
    const { data } = await axios.post(`/api/messages/${msgId}/transcribe`);
    return { text: data.text || '', cached: !!data.cached };
  } catch (e) {
    const status = e?.response?.status;
    let message;
    if (status === 503) message = '转写服务暂不可用，请稍后重试';
    else message = e?.response?.data?.error || '转写失败，请稍后重试';
    const err = new Error(message);
    err.status = status;
    throw err;
  }
}

