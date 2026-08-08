#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v信 语音转文字（ASR）独立服务
=================================
- 引擎：faster-whisper（CTranslate2 后端，CPU int8 量化），base 模型（~75MB）。
- 真实转写，绝不返回假数据；模型加载失败 / 转写异常一律返回非 200，由 Node 侧转 503。
- 接口：
    GET  /health              健康检查，返回 {ok, model, device}
    POST /transcribe          multipart/form-data，字段名 file=音频文件；
                              可选表单字段 language（默认 auto，中文可传 zh）。
                              返回 {text, language, duration}。
- 兼容前端录音格式（webm/ogg/mp3/m4a/wav 等）：faster-whisper 内部走 ffmpeg 解码，
  只要系统装了 ffmpeg 即可直接喂原始音频，无需前置转码。
- 并发与超时：uvicorn 单进程多线程；模型推理放线程池，避免阻塞事件循环；
  单请求音频体积上限由环境变量 ASR_MAX_BYTES 控制（默认 25MB）。
"""
import os
import time
import tempfile
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [asr] %(levelname)s %(message)s',
)
log = logging.getLogger('asr')

# ── 配置（全部可经环境变量覆盖）──────────────────────────────────
MODEL_SIZE = os.environ.get('ASR_MODEL', 'base')          # tiny/base/small/…
DEVICE     = os.environ.get('ASR_DEVICE', 'cpu')          # cpu / cuda
COMPUTE    = os.environ.get('ASR_COMPUTE', 'int8')        # int8 省内存、CPU 友好
HOST       = os.environ.get('ASR_HOST', '127.0.0.1')      # 默认仅本机，Node 同机调用
PORT       = int(os.environ.get('ASR_PORT', '18790'))
MAX_BYTES  = int(os.environ.get('ASR_MAX_BYTES', str(25 * 1024 * 1024)))
# 模型缓存目录：固定到服务目录下，避免依赖 HOME、便于运维备份
MODEL_DIR  = os.environ.get('ASR_MODEL_DIR', os.path.join(os.path.dirname(__file__), 'models'))

app = FastAPI(title='vxin-asr', docs_url=None, redoc_url=None)

# 推理线程池：单请求推理较重，限制并发数防止 CPU 过载导致整体超时
_pool = ThreadPoolExecutor(max_workers=int(os.environ.get('ASR_WORKERS', '2')))
_model = None
_model_err = None


def _load_model():
    """懒加载模型；失败记录错误，健康检查与转写据此返回非 200。"""
    global _model, _model_err
    if _model is not None or _model_err is not None:
        return
    try:
        from faster_whisper import WhisperModel
        t0 = time.time()
        os.makedirs(MODEL_DIR, exist_ok=True)
        _model = WhisperModel(
            MODEL_SIZE, device=DEVICE, compute_type=COMPUTE,
            download_root=MODEL_DIR,
        )
        log.info('模型加载成功 %s/%s/%s 用时 %.1fs', MODEL_SIZE, DEVICE, COMPUTE, time.time() - t0)
    except Exception as e:  # noqa: BLE001 —— 加载失败要整体上报，不能吞
        _model_err = str(e)
        log.error('模型加载失败: %s', e)


def _transcribe_file(path: str, language: str):
    """同步转写（在线程池执行）。返回 (text, language, duration)。"""
    lang = None if (not language or language == 'auto') else language
    segments, info = _model.transcribe(
        path,
        language=lang,
        beam_size=5,
        vad_filter=True,               # 语音活动检测，过滤静音降低幻听
        vad_parameters=dict(min_silence_duration_ms=500),
    )
    text = ''.join(seg.text for seg in segments).strip()
    return text, info.language, info.duration


@app.on_event('startup')
def _startup():
    _load_model()


@app.get('/health')
def health():
    if _model is None and _model_err is None:
        _load_model()
    if _model_err:
        return JSONResponse(status_code=503, content={'ok': False, 'error': _model_err})
    return {'ok': True, 'model': MODEL_SIZE, 'device': DEVICE, 'compute': COMPUTE}


@app.post('/transcribe')
async def transcribe(file: UploadFile = File(...), language: str = Form('auto')):
    if _model is None and _model_err is None:
        _load_model()
    if _model_err or _model is None:
        raise HTTPException(status_code=503, detail=f'ASR 模型不可用: {_model_err or "未加载"}')

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail='空音频文件')
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f'音频超过大小上限 {MAX_BYTES} 字节')

    # 落临时文件喂 ffmpeg 解码（faster-whisper 接收路径最稳）
    suffix = os.path.splitext(file.filename or '')[1] or '.bin'
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(data)
        tmp.flush()
        tmp.close()
        import asyncio
        loop = asyncio.get_event_loop()
        t0 = time.time()
        text, lang, dur = await loop.run_in_executor(_pool, _transcribe_file, tmp.name, language)
        log.info('转写完成 %d 字节 -> %d 字 (lang=%s, audio=%.1fs, cost=%.1fs)',
                 len(data), len(text), lang, dur or 0, time.time() - t0)
        return {'text': text, 'language': lang, 'duration': dur}
    except Exception as e:  # noqa: BLE001
        log.error('转写失败: %s', e)
        raise HTTPException(status_code=500, detail=f'转写失败: {e}')
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


if __name__ == '__main__':
    uvicorn.run(app, host=HOST, port=PORT, log_level='info')
