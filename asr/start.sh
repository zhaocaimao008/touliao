#!/usr/bin/env bash
# v信 ASR 服务启动脚本（nohup 守护 + 端口占用探测）
# 用法：./start.sh            前台启动（调试）
#      ./start.sh --daemon   后台常驻（nohup，日志写 asr.log）
set -euo pipefail
cd "$(dirname "$0")"

export ASR_HOST="${ASR_HOST:-127.0.0.1}"
export ASR_PORT="${ASR_PORT:-18790}"
export ASR_MODEL="${ASR_MODEL:-base}"
export ASR_DEVICE="${ASR_DEVICE:-cpu}"
export ASR_COMPUTE="${ASR_COMPUTE:-int8}"

PY="./venv/bin/python3"

if [ "${1:-}" = "--daemon" ]; then
  # 已在跑则不重复拉起
  if curl -sf "http://${ASR_HOST}:${ASR_PORT}/health" >/dev/null 2>&1; then
    echo "ASR 已在运行 (${ASR_HOST}:${ASR_PORT})"
    exit 0
  fi
  nohup "$PY" asr_server.py >> asr.log 2>&1 &
  echo "ASR 已后台启动 pid=$! 端口=${ASR_PORT}，日志: $(pwd)/asr.log"
else
  exec "$PY" asr_server.py
fi
