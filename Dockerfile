FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads outputs data

ENV MEDIASEARCH_UPLOAD_DIR=/app/uploads \
    MEDIASEARCH_OUTPUT_DIR=/app/outputs \
    MEDIASEARCH_DATA_DIR=/app/data \
    PORT=8000

EXPOSE 8000

# One worker: the CLIP/YOLO models are loaded once per worker process, and
# each is heavy enough (GBs of RAM/VRAM) that running several isn't "simple"
# to deploy. --threads lets one worker still serve requests concurrently.
CMD ["gunicorn", "-w", "1", "--threads", "4", "--timeout", "600", "-b", "0.0.0.0:8000", "wsgi:app"]
