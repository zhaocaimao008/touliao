"""Local NudeNet screening. No network, external credentials, or user-content logs.

The result covers exposed nudity only. Video and animation use bounded sampling;
it is not a claim that every kind of harmful content was reviewed.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import subprocess
import sys

BLOCKED_CLASSES = frozenset({
    'FEMALE_BREAST_EXPOSED', 'FEMALE_GENITALIA_EXPOSED',
    'MALE_GENITALIA_EXPOSED', 'ANUS_EXPOSED', 'BUTTOCKS_EXPOSED',
})


def is_blocked(detections, threshold):
    if not isinstance(detections, list):
        raise ValueError('invalid inference output')
    blocked = False
    for detection in detections:
        score = float(detection['score'])
        if not isinstance(detection.get('class'), str) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError('invalid inference output')
        blocked |= detection['class'] in BLOCKED_CLASSES and score >= threshold
    return blocked


def video_frames(filename, directory, maximum):
    # Disable URL protocols: even a hostile container cannot fetch network inputs.
    probe = subprocess.run([
        '/usr/bin/ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
        '-show_entries', 'format=duration:stream=codec_type,width,height,duration',
        '-of', 'json', filename,
    ], capture_output=True, text=True, timeout=8, check=True)
    metadata = json.loads(probe.stdout)
    tracks = [s for s in metadata.get('streams', []) if s.get('codec_type') == 'video']
    if len(tracks) != 1:
        raise ValueError('unsupported video tracks')
    duration = float(metadata.get('format', {}).get('duration') or tracks[0].get('duration') or 0)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('invalid duration')
    if tracks[0].get('width', 0) * tracks[0].get('height', 0) > 40_000_000:
        raise ValueError('oversized frame')
    rate = min(1.0, maximum / duration)
    subprocess.run([
        '/usr/bin/ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe',
        '-threads', '1', '-i', filename, '-map', '0:v:0', '-an', '-sn', '-dn',
        '-vf', f'fps={rate}:start_time=0:round=up,scale=640:640:force_original_aspect_ratio=decrease',
        '-frames:v', str(maximum), '-threads', '1', '-y', str(directory / '%03d.jpg'),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=40, check=True)
    frames = sorted(directory.glob('*.jpg'))
    if not frames:
        raise ValueError('no decodable video frames')
    return frames


def detector():
    import nudenet
    import onnxruntime as ort
    # NudeNet 3.4.2's public constructor uses ONNX defaults (one thread per CPU).
    # Set the same model/input fields with a bounded CPU-only session instead.
    model = Path(nudenet.__file__).parent / '320n.onnx'
    if (importlib.metadata.version('nudenet') != '3.4.2' or
            hashlib.sha256(model.read_bytes()).hexdigest() !=
            'c15d8273adad2d0a92f014cc69ab2d6c311a06777a55545f2c4eb46f51911f0f'):
        raise RuntimeError('unverified screening model')
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    result = nudenet.NudeDetector.__new__(nudenet.NudeDetector)
    result.onnx_session = ort.InferenceSession(str(model), sess_options=options,
                                             providers=['CPUExecutionProvider'])
    result.input_width = result.input_height = 320
    result.input_name = result.onnx_session.get_inputs()[0].name
    return result


def scan(model, kind, filename, work_dir, threshold, max_frames):
    if not 0 < threshold < 1 or not 1 <= max_frames <= 32:
        raise ValueError('invalid screening configuration')
    directory = Path(work_dir)
    try:
        frames = (video_frames(filename, directory, max_frames)
                  if kind == 'video' else sorted(directory.glob('*.jpg')))
        if not 1 <= len(frames) <= max_frames:
            raise ValueError('invalid frame count')
    except (ValueError, subprocess.CalledProcessError):
        return {'status': 'invalid'}
    for index, frame in enumerate(frames):
        if is_blocked(model.detect(str(frame)), threshold):
            return {'status': 'blocked', 'scope': 'nudity',
                    'model': 'nudenet-320n-3.4.2', 'frames': index + 1}
    return {'status': 'approved', 'scope': 'nudity',
            'model': 'nudenet-320n-3.4.2', 'frames': len(frames)}


def serve():
    """常驻模式：模型只加载一次（约 0.33s），之后每行一个 JSON 请求、回一行 JSON 结果。

    单张识别约 37ms；逐次启动时每张都要重新 import + 加载模型。任何未预期的异常只回
    status=error（调用方按不可用处理，绝不放行），进程继续服务下一条。
    """
    model = detector()
    print(json.dumps({'ready': True, 'model': 'nudenet-320n-3.4.2'}), flush=True)
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request['id']
            result = scan(model, request['kind'], request['input'], request['workDir'],
                          float(request['threshold']), int(request['maxFrames']))
        except Exception:
            result = {'status': 'error'}
        result['id'] = request_id
        print(json.dumps(result), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--kind', choices=['image', 'video'])
    parser.add_argument('--input')
    parser.add_argument('--work-dir')
    parser.add_argument('--threshold', type=float)
    parser.add_argument('--max-frames', type=int)
    args = parser.parse_args()
    if args.serve:
        serve()
        return
    if not (args.kind and args.input and args.work_dir and args.threshold is not None and args.max_frames):
        parser.error('--kind, --input, --work-dir, --threshold and --max-frames are required')
    if not 0 < args.threshold < 1 or not 1 <= args.max_frames <= 32:
        raise ValueError('invalid screening configuration')
    # Load the actual model before emitting any decision. Missing dependencies,
    # corrupt weights, and inference errors exit nonzero and never approve media.
    model = detector()
    print(json.dumps(scan(model, args.kind, args.input, args.work_dir, args.threshold, args.max_frames)))


if __name__ == '__main__':
    main()
