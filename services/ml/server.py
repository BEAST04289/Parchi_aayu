"""
Parchi local ML service: OCR (PP-OCR models run by RapidOCR on ONNX Runtime; real word + line
coordinates) and faster-whisper (speech).

Why RapidOCR instead of the paddleocr package: on this Windows laptop paddlepaddle 3.3.1 crashes in its
oneDNN path ("ConvertPirAttribute2RuntimeAttribute not support"), and with oneDNN off it took ~22 s per
page. RapidOCR runs the same PP-OCR detection/recognition models via ONNX Runtime in ~4 s per page.

- Binds to 127.0.0.1 only. Every request except /health needs header x-ml-token == ML_SERVICE_TOKEN.
- One inference at a time per model (locks). Models load lazily on first use (or via /warmup).
- Never logs request content (images, audio, text). Only sizes, timings and errors.

Run: services/ml/.venv/Scripts/python.exe services/ml/server.py   (scripts/start-local.ps1 does this)
"""
import hmac
import json
import os
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = int(os.environ.get("ML_PORT", "8765"))
TOKEN = os.environ.get("ML_SERVICE_TOKEN", "")
MAX_BODY = 12 * 1024 * 1024
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")

_ocr = None
_ocr_lock = threading.Lock()
_asr = None
_asr_lock = threading.Lock()
_versions = {}


def log(msg):
    print(f"[ml {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def get_ocr():
    """RapidOCR with orientation classification OFF so polygons stay in the stored image's coordinates."""
    global _ocr
    if _ocr is None:
        from rapidocr import RapidOCR
        import rapidocr
        _versions["rapidocr"] = getattr(rapidocr, "__version__", "?")
        t = time.time()
        _ocr = RapidOCR(params={"Global.use_cls": False})
        log(f"OCR loaded (RapidOCR {_versions['rapidocr']}) in {time.time() - t:.1f}s")
    return _ocr


def get_asr():
    global _asr
    if _asr is None:
        from faster_whisper import WhisperModel
        import faster_whisper
        _versions["faster_whisper"] = getattr(faster_whisper, "__version__", "?")
        t = time.time()
        _asr = WhisperModel(WHISPER_MODEL, device="cpu", compute_type=WHISPER_COMPUTE)
        log(f"ASR loaded (whisper {WHISPER_MODEL}, cpu {WHISPER_COMPUTE}) in {time.time() - t:.1f}s")
    return _asr


def _to_list(x):
    return x.tolist() if hasattr(x, "tolist") else x


def run_ocr(data: bytes, params=None):
    import base64
    import cv2
    import numpy as np
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("could not decode image")
    h, w = img.shape[:2]
    vlm_b64 = None
    vlm_max = int((params or {}).get("vlm_max", ["0"])[0] or 0)
    if vlm_max > 0:
        s = min(1.0, vlm_max / max(w, h))
        small = cv2.resize(img, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA) if s < 1 else img
        ok, enc = cv2.imencode(".jpg", small, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        vlm_b64 = base64.b64encode(enc.tobytes()).decode("ascii") if ok else None
    cold = _ocr is None
    with _ocr_lock:
        ocr = get_ocr()
        t = time.time()
        out = ocr(img, use_cls=False, return_word_box=True)
        ms = int((time.time() - t) * 1000)

    def norm_box(poly):
        if poly is None or len(poly) < 4:
            return None
        xs = [float(p[0]) for p in poly]
        ys = [float(p[1]) for p in poly]
        return [max(0.0, min(xs) / w), max(0.0, min(ys) / h), min(1.0, max(xs) / w), min(1.0, max(ys) / h)]

    def inside(b, line, tol=0.01):
        return b and line and b[0] >= line[0] - tol and b[1] >= line[1] - tol and b[2] <= line[2] + tol and b[3] <= line[3] + tol

    txts = list(out.txts or [])
    scores = list(out.scores or [])
    boxes = _to_list(out.boxes) if out.boxes is not None else []
    word_results = list(out.word_results or [])
    lines = []
    for i, text in enumerate(txts):
        if not str(text).strip():
            continue
        lbox = norm_box(boxes[i]) if i < len(boxes) else None
        words = []
        for wr in (word_results[i] if i < len(word_results) else []):
            wtext, wconf, wpoly = wr[0], wr[1], wr[2]
            wbox = norm_box(wpoly)
            # Keep only word boxes that lie inside their own line box; never invent positions.
            if str(wtext).strip() and inside(wbox, lbox):
                words.append({"text": str(wtext), "conf": float(wconf), "box": wbox})
        lines.append({"text": str(text), "conf": float(scores[i]) if i < len(scores) else None, "box": lbox, "words": words})
    return {
        "width": w, "height": h, "lines": lines, "ms": ms, "cold": cold,
        "model": f"PP-OCR via RapidOCR {_versions.get('rapidocr', '?')} (ONNX Runtime, local CPU)",
        "granularity": "word", "vlm_jpeg_b64": vlm_b64,
    }


def run_asr(data: bytes, params):
    language = params.get("language", ["hi"])[0] or None
    task = params.get("task", ["transcribe"])[0]
    prompt = params.get("initial_prompt", [None])[0]
    cold = _asr is None
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as f:
        f.write(data)
        path = f.name
    try:
        with _asr_lock:
            model = get_asr()
            t = time.time()
            segments, info = model.transcribe(path, language=language, task=task, beam_size=5, vad_filter=True,
                                              initial_prompt=prompt, condition_on_previous_text=False)
            segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]
            ms = int((time.time() - t) * 1000)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    return {
        "text": " ".join(s["text"] for s in segs).strip(), "segments": segs, "language": info.language,
        "language_probability": round(info.language_probability, 3), "duration_s": round(info.duration, 2),
        "ms": ms, "cold": cold, "task": task,
        "model": f"faster-whisper {_versions.get('faster_whisper', '?')} {WHISPER_MODEL} (local, CPU {WHISPER_COMPUTE})",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "parchi-ml"

    def log_message(self, fmt, *args):  # no request logging (paths only would be fine, but keep quiet)
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        given = self.headers.get("x-ml-token", "")
        return bool(TOKEN) and hmac.compare_digest(given, TOKEN)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health":
            return self._send(200, {"ok": True, "ocr_loaded": _ocr is not None, "asr_loaded": _asr is not None,
                                    "ocr_engine": "rapidocr", "whisper_model": WHISPER_MODEL, "versions": _versions})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        n = int(self.headers.get("Content-Length", "0") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(413, {"error": f"body must be 1..{MAX_BODY} bytes"})
        data = self.rfile.read(n)
        try:
            if u.path == "/ocr":
                out = run_ocr(data, parse_qs(u.query))
                log(f"ocr {n}B -> {len(out['lines'])} lines in {out['ms']}ms{' (cold)' if out['cold'] else ''}")
                return self._send(200, out)
            if u.path == "/transcribe":
                out = run_asr(data, parse_qs(u.query))
                log(f"asr {n}B -> {len(out['segments'])} segments in {out['ms']}ms{' (cold)' if out['cold'] else ''}")
                return self._send(200, out)
            if u.path == "/warmup":
                what = parse_qs(u.query).get("what", ["ocr"])[0]
                t = time.time()
                get_ocr() if what == "ocr" else get_asr()
                return self._send(200, {"ok": True, "what": what, "ms": int((time.time() - t) * 1000)})
            return self._send(404, {"error": "not found"})
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            log(f"error on {u.path}: {type(e).__name__}: {e}")
            traceback.print_exc(limit=3)
            return self._send(500, {"error": f"{type(e).__name__}: {e}"})


def main():
    if not TOKEN or len(TOKEN) < 16:
        print("ML_SERVICE_TOKEN (16+ chars) must be set", file=sys.stderr)
        sys.exit(2)
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f"listening on http://{HOST}:{PORT} (OCR RapidOCR, whisper {WHISPER_MODEL})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
