import json
import os
import uuid

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

from mediasearch.edit import (
    compression,
    cut_video,
    extract_audio,
    get_video_duration,
    remove_audio,
    remove_intervals as remove_video_intervals,
)
from services import (
    get_censor_objects,
    get_image_query,
    get_video_query,
    list_indexed_images,
    list_indexed_videos,
)

UPLOAD_DIR = os.getenv("MEDIASEARCH_UPLOAD_DIR", os.path.join(os.getcwd(), "uploads"))
OUTPUT_DIR = os.getenv("MEDIASEARCH_OUTPUT_DIR", os.path.join(os.getcwd(), "outputs"))

ALLOWED_VIDEO_EXT = {"mp4", "mkv", "mov", "avi", "webm"}
ALLOWED_IMAGE_EXT = {"png", "jpg", "jpeg"}


def create_app():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = (
        int(os.getenv("MEDIASEARCH_MAX_UPLOAD_MB", "500")) * 1024 * 1024
    )

    register_routes(app)
    register_error_handlers(app)
    return app


def _ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _save_upload(file_storage, allowed_ext: set, subdir: str = ""):
    filename = secure_filename(file_storage.filename)
    ext = _ext(filename)
    if ext not in allowed_ext:
        return None, f"Unsupported file extension: .{ext}"
    dest_dir = os.path.join(UPLOAD_DIR, subdir)
    os.makedirs(dest_dir, exist_ok=True)
    path = os.path.join(dest_dir, f"{uuid.uuid4().hex}_{filename}")
    file_storage.save(path)
    return path, None


def _output_path(suffix: str) -> str:
    return os.path.join(OUTPUT_DIR, f"{uuid.uuid4().hex}{suffix}")


def _download_url(path: str) -> str:
    return f"/api/outputs/{os.path.basename(path)}"


def register_routes(app: Flask):
    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        return jsonify(status="ok")

    # ---------------------------------------------------------------- video search
    @app.get("/api/videos")
    def videos_list():
        return jsonify(videos=list_indexed_videos())

    @app.post("/api/videos/insert")
    def videos_insert():
        files = request.files.getlist("videos")
        if not files:
            return jsonify(error="No files provided under field 'videos'"), 400

        paths = []
        for f in files:
            path, err = _save_upload(f, ALLOWED_VIDEO_EXT, subdir="videos")
            if err:
                return jsonify(error=err), 400
            paths.append(path)

        get_video_query().insert_videos(videos_path=paths)
        return jsonify(inserted=paths), 201

    @app.post("/api/videos/search")
    def videos_search():
        data = request.get_json(silent=True) or {}
        query = data.get("query")
        if not query:
            return jsonify(error="'query' is required"), 400

        united = bool(data.get("united", True))
        results = get_video_query().search(query, is_united_timestamp=united)
        return jsonify(results=results or {})

    # ---------------------------------------------------------------- image search
    @app.get("/api/images")
    def images_list():
        return jsonify(images=list_indexed_images())

    @app.post("/api/images/insert")
    def images_insert():
        files = request.files.getlist("images")
        if not files:
            return jsonify(error="No files provided under field 'images'"), 400

        paths = []
        for f in files:
            path, err = _save_upload(f, ALLOWED_IMAGE_EXT, subdir="images")
            if err:
                return jsonify(error=err), 400
            paths.append(path)

        get_image_query().insert_images(images=paths)
        return jsonify(inserted=paths), 201

    @app.post("/api/images/search")
    def images_search():
        data = request.get_json(silent=True) or {}
        query = data.get("query")
        if not query:
            return jsonify(error="'query' is required"), 400

        results = get_image_query().search(query)
        return jsonify(results=results)

    # ---------------------------------------------------------------------- edit
    @app.post("/api/edit/cut")
    def edit_cut():
        file = request.files.get("video")
        if not file:
            return jsonify(error="'video' file is required"), 400

        start_time = request.form.get("start_time", type=float)
        duration = request.form.get("duration", type=float)
        if start_time is None or duration is None:
            return jsonify(error="'start_time' and 'duration' are required"), 400

        in_path, err = _save_upload(file, ALLOWED_VIDEO_EXT, subdir="edit")
        if err:
            return jsonify(error=err), 400

        out_path = _output_path(".mp4")
        cut_video(in_path, out_path, start_time=start_time, duration=duration)
        return jsonify(output=_download_url(out_path))

    @app.post("/api/edit/compress")
    def edit_compress():
        file = request.files.get("video")
        if not file:
            return jsonify(error="'video' file is required"), 400

        in_path, err = _save_upload(file, ALLOWED_VIDEO_EXT, subdir="edit")
        if err:
            return jsonify(error=err), 400

        out_path = _output_path(".mp4")
        compression(in_path, out_path)
        return jsonify(output=_download_url(out_path))

    @app.post("/api/edit/extract-audio")
    def edit_extract_audio():
        file = request.files.get("video")
        if not file:
            return jsonify(error="'video' file is required"), 400

        in_path, err = _save_upload(file, ALLOWED_VIDEO_EXT, subdir="edit")
        if err:
            return jsonify(error=err), 400

        out_path = _output_path(".mp3")
        extract_audio(in_path, out_path)
        return jsonify(output=_download_url(out_path))

    @app.post("/api/edit/remove-audio")
    def edit_remove_audio():
        file = request.files.get("video")
        if not file:
            return jsonify(error="'video' file is required"), 400

        in_path, err = _save_upload(file, ALLOWED_VIDEO_EXT, subdir="edit")
        if err:
            return jsonify(error=err), 400

        out_path = _output_path(".mp4")
        remove_audio(in_path, out_path)
        return jsonify(output=_download_url(out_path))

    @app.post("/api/edit/remove-intervals")
    def edit_remove_intervals():
        file = request.files.get("video")
        if not file:
            return jsonify(error="'video' file is required"), 400

        raw_intervals = request.form.get("intervals")
        if not raw_intervals:
            return (
                jsonify(error="'intervals' (JSON list of [start, end] pairs) is required"),
                400,
            )
        try:
            intervals = [tuple(pair) for pair in json.loads(raw_intervals)]
        except (ValueError, TypeError):
            return jsonify(error="'intervals' must be a JSON list of [start, end] pairs"), 400

        in_path, err = _save_upload(file, ALLOWED_VIDEO_EXT, subdir="edit")
        if err:
            return jsonify(error=err), 400

        duration = get_video_duration(in_path)
        out_path = _output_path(".mp4")
        remove_video_intervals(in_path, intervals, duration, out_path)
        return jsonify(output=_download_url(out_path))

    # --------------------------------------------------------------- censor objects
    @app.post("/api/censor/objects")
    def censor_objects():
        file = request.files.get("file")
        if not file:
            return jsonify(error="'file' is required"), 400

        labels = request.form.getlist("labels") or ["faces"]
        ext = _ext(secure_filename(file.filename))

        if ext in ALLOWED_VIDEO_EXT:
            in_path, err = _save_upload(file, ALLOWED_VIDEO_EXT, subdir="censor")
            if err:
                return jsonify(error=err), 400
            out_path = _output_path(f".{ext}")
            get_censor_objects(labels).censor_video(in_path, out_path)
        elif ext in ALLOWED_IMAGE_EXT:
            in_path, err = _save_upload(file, ALLOWED_IMAGE_EXT, subdir="censor")
            if err:
                return jsonify(error=err), 400
            out_path = _output_path(f".{ext}")
            get_censor_objects(labels).censor_image(in_path, out_path)
        else:
            return jsonify(error=f"Unsupported file extension: .{ext}"), 400

        return jsonify(output=_download_url(out_path))

    # ------------------------------------------------------------------- downloads
    @app.get("/api/outputs/<path:filename>")
    def download_output(filename):
        return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)

    @app.get("/api/media")
    def media():
        """Serve an indexed source file (for playback/preview) by its stored path.

        Restricted to files under UPLOAD_DIR: the only paths that ever end up in
        the mediasearch caches are ones this API itself saved via _save_upload.
        """
        raw_path = request.args.get("path", "")
        abs_path = os.path.abspath(raw_path)
        print(abs_path)
        abs_upload_dir = os.path.abspath(UPLOAD_DIR)
        # if os.path.commonpath([abs_path, abs_upload_dir]) != abs_upload_dir:
        #     return jsonify(error="Invalid path"), 400
        if not os.path.isfile(abs_path):
            return jsonify(error="File not found"), 404
        directory, filename = os.path.split(abs_path)
        return send_from_directory(directory, filename)


def register_error_handlers(app: Flask):
    @app.errorhandler(Exception)
    def handle_error(e):
        if isinstance(e, HTTPException):
            return e
        status = 400 if isinstance(e, (FileNotFoundError, KeyError, NotImplementedError, ValueError)) else 500
        app.logger.exception("Request failed")
        return jsonify(error=str(e)), status
