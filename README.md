# mediasearch-api

A simple Flask REST API + web UI around the [`mediasearch`](https://github.com/otman-ai/mediasearch)
Python library. This project only *depends on* `mediasearch` (installed as a normal pip package) —
it does not vendor or modify its source.

## Web UI

Open `http://localhost:5000/` (or wherever it's deployed) for a browser UI to:
- browse everything currently indexed (video/image library, with inline playback and thumbnails)
- upload and index new videos/images
- search and jump straight to the matching clip (click a timestamp to seek the player) or ranked
  image results

It's a static page (`templates/index.html`, `static/app.js`, `static/style.css`) calling the same
JSON API below — no build step, no framework.

## Endpoints

| Method | Path                          | Description                                              |
|--------|-------------------------------|------------------------------------------------------------|
| GET    | `/`                            | Web UI                                                     |
| GET    | `/api/health`                 | Health check                                              |
| GET    | `/api/videos`                 | List indexed videos (path, fps, duration)                 |
| POST   | `/api/videos/insert`          | Upload videos (`videos` field, multiple) and index them   |
| POST   | `/api/videos/search`          | JSON `{"query": "...", "united": true}`                   |
| GET    | `/api/images`                 | List indexed images (path)                                |
| POST   | `/api/images/insert`          | Upload images (`images` field, multiple) and index them   |
| POST   | `/api/images/search`          | JSON `{"query": "..."}`                                   |
| POST   | `/api/edit/cut`               | Form: `video` file, `start_time`, `duration`               |
| POST   | `/api/edit/compress`          | Form: `video` file                                         |
| POST   | `/api/edit/extract-audio`     | Form: `video` file                                          |
| POST   | `/api/edit/remove-audio`      | Form: `video` file                                          |
| POST   | `/api/edit/remove-intervals`  | Form: `video` file, `intervals` (JSON `[[s,e], ...]`)      |
| POST   | `/api/censor/objects`         | Form: `file` (video or image), `labels` (`faces`, `license_plates`) |
| GET    | `/api/media?path=<path>`      | Stream/preview an indexed source file (used by the UI)    |
| GET    | `/api/outputs/<filename>`     | Download a generated file                                  |

Editing/censoring endpoints return `{"output": "/api/outputs/<file>"}` — fetch that URL to
download the result. `/api/media` only serves files under `MEDIASEARCH_UPLOAD_DIR` (i.e. files
this API itself indexed), so it can't be used to read arbitrary paths off disk.

## Local setup

Requires [FFmpeg](https://ffmpeg.org/) on the `PATH` (same requirement as `mediasearch` itself).

```bash
python -m venv .venv
source .venv/bin/activate   # .venv\Scripts\activate on Windows
pip install -r requirements.txt

python run.py   # http://localhost:5000
```

### Example requests

```bash
curl -X POST http://localhost:5000/api/videos/insert \
  -F "videos=@assets/video0.mp4"

curl -X POST http://localhost:5000/api/videos/search \
  -H "Content-Type: application/json" \
  -d '{"query": "dogs running"}'

curl -X POST http://localhost:5000/api/censor/objects \
  -F "file=@video.mp4" -F "labels=faces"
```

## Deployment (Docker)

```bash
docker build -t mediasearch-api .
docker run -p 8000:8000 mediasearch-api
```

Notes:
- The CLIP/YOLO models are loaded lazily, once per process, and cached in memory (see
  `services.py`) — the first search/censor request after startup will be slower.
- Because those models are heavy, the container runs a single Gunicorn worker
  (`--threads 4` for concurrency instead of extra worker processes). Scale out with multiple
  container replicas behind a load balancer rather than multiple workers per container.
- `CensorObjects` downloads YOLO weights on first use, so the container needs outbound internet
  access the first time each label (`faces`, `license_plates`) is used.
- Uploaded files, generated outputs, and the search index (`.h5` embeddings cache) are stored on
  local disk under `uploads/`, `outputs/`, and `data/` — mount volumes for these paths if you need
  them to persist across container restarts.

## Configuration (env vars)

| Variable                     | Default        | Purpose                                  |
|-------------------------------|----------------|-------------------------------------------|
| `MEDIASEARCH_MODEL`           | `ViT-B/32`     | CLIP model used for search                |
| `MEDIASEARCH_FRAME_RATE`      | `10`           | Video frame sampling rate                 |
| `MEDIASEARCH_THRESHOLD`       | `0.25`         | Search similarity threshold               |
| `MEDIASEARCH_UPLOAD_DIR`      | `./uploads`    | Where uploaded files are stored           |
| `MEDIASEARCH_OUTPUT_DIR`      | `./outputs`    | Where generated files are stored          |
| `MEDIASEARCH_DATA_DIR`        | `./data`       | Where the search index (`.h5` cache) is stored |
| `MEDIASEARCH_MAX_UPLOAD_MB`   | `500`          | Max request body size                     |
| `PORT`                        | `5000`         | Port for `run.py`                         |
