"""Persistent parakeet-mlx transcription sidecar.

Protocol:
  stdin  — one JSON request per line: {"audio_path": "/path/to/file.ogg"}
  stdout — one JSON reply per line:   {"text": "..."} or {"error": "..."}
  stderr — diagnostic logging

Load parakeet once on startup, stay warm, transcribe on demand. Any audio
format ffmpeg can decode is accepted; it's normalized to 16kHz mono float32.
"""

import json
import os
import subprocess
import sys

# Serve the model from the repo's own cache. No network at runtime.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_SCRIPT_DIR)
_MODEL_DIR = os.path.join(_REPO_ROOT, "data", "models", "parakeet")
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"

import mlx.core as mx
import numpy as np
from parakeet_mlx import from_pretrained as parakeet_from_pretrained
from parakeet_mlx.audio import get_logmel

SAMPLE_RATE = 16000
MODEL_ID = "mlx-community/parakeet-tdt-0.6b-v3"


def log(msg):
    print(f"[transcription_worker] {msg}", file=sys.stderr, flush=True)


def load_model():
    log(f"loading {MODEL_ID} from {_MODEL_DIR}")
    model = parakeet_from_pretrained(MODEL_ID, cache_dir=_MODEL_DIR)
    log("model ready")
    return model


def audio_from_file(path):
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error",
         "-i", path, "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "f32le", "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode().strip()}")
    return np.frombuffer(proc.stdout, dtype=np.float32)


def transcribe(model, audio_np):
    audio_mx = mx.array(audio_np)
    mel = get_logmel(audio_mx, model.preprocessor_config)
    results = model.generate(mel)
    return results[0].text


def reply(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    model = load_model()
    reply({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            audio_path = req["audio_path"]
            audio = audio_from_file(audio_path)
            if audio.size == 0:
                reply({"text": ""})
                continue
            text = transcribe(model, audio).strip()
            reply({"text": text})
        except Exception as e:
            log(f"error: {e}")
            reply({"error": str(e)})


if __name__ == "__main__":
    main()
