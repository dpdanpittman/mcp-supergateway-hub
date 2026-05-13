"""
Coqui XTTS v2 TTS Server
Lightweight FastAPI wrapper around the TTS library.
Runs on CPU by default (GPU consumed by Ollama on zaphod).

XTTS v2 is a voice-cloning model — it needs a reference WAV to define
the speaker voice. If no speaker_wav is provided in the request, the
server uses a built-in default reference clip at /app/voices/default.wav.

API:
  POST /tts         — Generate speech from text, returns WAV audio
  GET  /speakers    — List available speaker voices
  GET  /health      — Health check
"""

import io
import os
import time
import logging
import tempfile

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-server")

app = FastAPI(title="Coqui XTTS v2 TTS Server")

# Lazy-load the model on first request to speed up container startup
_tts = None
MODEL_NAME = os.environ.get("TTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
DEVICE = os.environ.get("TTS_DEVICE", "cpu")
DEFAULT_VOICE = os.environ.get("DEFAULT_VOICE", "/app/voices/default.wav")


def get_tts():
    global _tts
    if _tts is None:
        logger.info(f"Loading model: {MODEL_NAME} on {DEVICE}")
        from TTS.api import TTS
        _tts = TTS(model_name=MODEL_NAME).to(DEVICE)
        logger.info("Model loaded successfully")
    return _tts


def get_default_voice():
    """Return the default voice reference path, generating one if needed."""
    if os.path.exists(DEFAULT_VOICE):
        return DEFAULT_VOICE

    # Generate a bootstrap reference clip using a simpler TTS model
    logger.info("No default voice found, generating bootstrap reference...")
    os.makedirs(os.path.dirname(DEFAULT_VOICE), exist_ok=True)

    from TTS.api import TTS
    bootstrap = TTS(model_name="tts_models/en/ljspeech/tacotron2-DDC").to(DEVICE)
    bootstrap.tts_to_file(
        text="I am ARIA, your advanced reconnaissance and intelligence agent. I will be your guide through the cosmos.",
        file_path=DEFAULT_VOICE,
    )
    del bootstrap
    logger.info(f"Bootstrap voice saved to {DEFAULT_VOICE}")
    return DEFAULT_VOICE


class TTSRequest(BaseModel):
    text: str
    language: str = "en"
    speaker_wav: Optional[str] = None


@app.post("/tts")
async def generate_tts(req: TTSRequest):
    """Generate speech from text. Returns WAV audio."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    tts = get_tts()
    start = time.time()

    try:
        # Use provided speaker_wav or fall back to default voice
        speaker_wav = req.speaker_wav
        if not speaker_wav or not os.path.exists(speaker_wav):
            speaker_wav = get_default_voice()

        # XTTS v2 needs a real file path, not a BytesIO
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name

        tts.tts_to_file(
            text=req.text,
            language=req.language,
            speaker_wav=speaker_wav,
            file_path=tmp_path,
        )

        # Read the generated file into memory
        with open(tmp_path, "rb") as f:
            audio_bytes = f.read()
        os.unlink(tmp_path)

        elapsed = time.time() - start
        logger.info(f"Generated {len(req.text)} chars in {elapsed:.1f}s ({len(audio_bytes)} bytes)")

        return StreamingResponse(
            io.BytesIO(audio_bytes),
            media_type="audio/wav",
            headers={
                "X-Generation-Time": f"{elapsed:.1f}",
                "Content-Disposition": "attachment; filename=output.wav",
            },
        )
    except Exception as e:
        logger.error(f"TTS generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload-voice")
async def upload_voice(name: str = Form(...), file: UploadFile = File(...)):
    """Upload a reference WAV file to use as a speaker voice."""
    voice_dir = "/app/voices"
    os.makedirs(voice_dir, exist_ok=True)
    voice_path = os.path.join(voice_dir, f"{name}.wav")

    content = await file.read()
    with open(voice_path, "wb") as f:
        f.write(content)

    return {"status": "ok", "voice_path": voice_path, "size_bytes": len(content)}


@app.get("/speakers")
async def list_speakers():
    """List available voice reference files."""
    voice_dir = "/app/voices"
    if not os.path.exists(voice_dir):
        return []
    voices = [f.replace(".wav", "") for f in os.listdir(voice_dir) if f.endswith(".wav")]
    return voices


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_NAME, "device": DEVICE}
