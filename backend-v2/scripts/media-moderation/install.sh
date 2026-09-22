#!/usr/bin/env bash
set -euo pipefail
media_runtime="${1:?Usage: install.sh /absolute/path/to/media-runtime}"
[[ "$media_runtime" = /* ]] || { echo 'Runtime path must be absolute' >&2; exit 1; }
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
media_script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
python3 -m venv "$media_runtime"
"$media_runtime/bin/python" -m pip install --disable-pip-version-check -r "$media_script_dir/requirements.txt"
"$media_runtime/bin/python" -m pip check
