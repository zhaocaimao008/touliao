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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', choices=['image', 'video'], required=True)
    parser.add_argument('--input', required=True)
    parser.add_argument('--work-dir', required=True)
    parser.add_argument('--threshold', type=float, required=True)
    parser.add_argument('--max-frames', type=int, required=True)
    args = parser.parse_args()
    if not 0 < args.threshold < 1 or not 1 <= args.max_frames <= 32:
        raise ValueError('invalid screening configuration')
    # Load the actual model before emitting any decision. Missing dependencies,
    # corrupt weights, and inference errors exit nonzero and never approve media.
    model = detector()
    directory = Path(args.work_dir)
    try:
        frames = (video_frames(args.input, directory, args.max_frames)
                  if args.kind == 'video' else sorted(directory.glob('*.jpg')))
        if not 1 <= len(frames) <= args.max_frames:
            raise ValueError('invalid frame count')
    except (ValueError, subprocess.CalledProcessError):
        print(json.dumps({'status': 'invalid'}))
        return
    for index, frame in enumerate(frames):
        if is_blocked(model.detect(str(frame)), args.threshold):
            print(json.dumps({'status': 'blocked', 'scope': 'nudity',
                              'model': 'nudenet-320n-3.4.2', 'frames': index + 1}))
            return
    print(json.dumps({'status': 'approved', 'scope': 'nudity',
                      'model': 'nudenet-320n-3.4.2', 'frames': len(frames)}))


if __name__ == '__main__':
    main()
