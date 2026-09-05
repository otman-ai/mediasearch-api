"""
Lazy singletons for mediasearch objects.

Model loading (CLIP for search, YOLO for object censoring) is expensive, so
each of these is created once and reused across requests instead of per-call.
"""
import os
import threading

import h5py

from mediasearch.vit import VideoQuery, ImageQuery
from mediasearch.edit import CensorObjects

# By default VideoQuery/ImageQuery cache their embeddings under the *global*
# ~/.cache/mediasearch/*.h5 files, shared by every mediasearch user on the
# machine. That would mix this API's index with unrelated local usage of the
# library, so it gets its own cache files instead.
DATA_DIR = os.getenv("MEDIASEARCH_DATA_DIR", os.path.join(os.getcwd(), "data"))
VIDEO_CASH_PATH = os.path.join(DATA_DIR, "video_embeddings.h5")
IMAGE_CASH_PATH = os.path.join(DATA_DIR, "image_embeddings.h5")

_lock = threading.Lock()
_video_query = None
_image_query = None
_censor_objects = {}


def get_video_query() -> VideoQuery:
    global _video_query
    if _video_query is None:
        with _lock:
            if _video_query is None:
                os.makedirs(DATA_DIR, exist_ok=True)
                _video_query = VideoQuery(
                    model_name=os.getenv("MEDIASEARCH_MODEL", "ViT-B/32"),
                    frame_rate=int(os.getenv("MEDIASEARCH_FRAME_RATE", "10")),
                    threshold=float(os.getenv("MEDIASEARCH_THRESHOLD", "0.25")),
                    cash=VIDEO_CASH_PATH,
                )
    return _video_query


def get_image_query() -> ImageQuery:
    global _image_query
    if _image_query is None:
        with _lock:
            if _image_query is None:
                os.makedirs(DATA_DIR, exist_ok=True)
                _image_query = ImageQuery(
                    model_name=os.getenv("MEDIASEARCH_MODEL", "ViT-B/32"),
                    threshold=float(os.getenv("MEDIASEARCH_THRESHOLD", "0.25")),
                    cash=IMAGE_CASH_PATH,
                )
    return _image_query


def get_censor_objects(labels: list) -> CensorObjects:
    key = tuple(sorted(labels))
    if key not in _censor_objects:
        with _lock:
            if key not in _censor_objects:
                _censor_objects[key] = CensorObjects(labels=list(key))
    return _censor_objects[key]


def list_indexed_videos() -> list:
    """Read the video embeddings cache directly, without loading the CLIP model."""
    if not os.path.exists(VIDEO_CASH_PATH):
        return []
    items = []
    with h5py.File(VIDEO_CASH_PATH, "r") as f:
        for key in f.keys():
            grp = f[key]
            items.append(
                {
                    "id": key,
                    "path": grp["video"][0].decode("utf-8"),
                    "fps": float(grp["fps"][0]),
                    "duration": float(grp["duration"][0]),
                }
            )
    return items


def list_indexed_images() -> list:
    """Read the image embeddings cache directly, without loading the CLIP model."""
    if not os.path.exists(IMAGE_CASH_PATH):
        return []
    items = []
    with h5py.File(IMAGE_CASH_PATH, "r") as f:
        for key in f.keys():
            grp = f[key]
            items.append(
                {
                    "id": key,
                    "path": grp["image"][0].decode("utf-8"),
                }
            )
    return items
