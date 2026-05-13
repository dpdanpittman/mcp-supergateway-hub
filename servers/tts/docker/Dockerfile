FROM python:3.11-slim

# System deps for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy server
COPY server.py .

# Model cache + voice reference directories
ENV TTS_HOME=/app/models
ENV DEFAULT_VOICE=/app/voices/default.wav
RUN mkdir -p /app/models /app/voices

# Accept Coqui TOS for model downloads
ENV COQUI_TOS_AGREED=1

EXPOSE 3240

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "3240"]
