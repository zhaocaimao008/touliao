import { describe, test, expect, vi, beforeEach } from 'vitest';

// 桩掉 axios：仅验证 transcribeVoice 的请求路径与错误规整逻辑（不打真实网络）。
vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

import axios from 'axios';
import { transcribeVoice } from './transcribe';

describe('transcribeVoice', () => {
  beforeEach(() => { axios.post.mockReset(); });

  test('成功：返回 text 与 cached，并请求正确路径', async () => {
    axios.post.mockResolvedValueOnce({ data: { text: '你好今天天气不错', cached: false } });
    const r = await transcribeVoice('m1');
    expect(axios.post).toHaveBeenCalledWith('/api/messages/m1/transcribe');
    expect(r.text).toBe('你好今天天气不错');
    expect(r.cached).toBe(false);
  });

  test('命中缓存：cached=true', async () => {
    axios.post.mockResolvedValueOnce({ data: { text: '已缓存文本', cached: true } });
    const r = await transcribeVoice('m2');
    expect(r.cached).toBe(true);
  });

  test('503：抛出「转写服务暂不可用」文案', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 503, data: { error: 'x' } } });
    await expect(transcribeVoice('m3')).rejects.toThrow('转写服务暂不可用，请稍后重试');
  });

  test('其它错误：用后端 error 文案兜底', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: { error: '仅语音消息支持转文字' } } });
    await expect(transcribeVoice('m4')).rejects.toThrow('仅语音消息支持转文字');
  });

  test('缺少 msgId：直接抛错，不发请求', async () => {
    await expect(transcribeVoice('')).rejects.toThrow('缺少消息标识');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

