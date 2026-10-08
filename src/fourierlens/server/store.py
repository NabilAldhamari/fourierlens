"""In-memory image store with LRU eviction and per-image render caching.

A local single-user tool: no persistence, no auth. Uploaded images live in RAM
as 8-bit RGB; rendered views are cached as PNG bytes so flipping between tabs
or sweeping a slider back costs nothing.
"""

from __future__ import annotations

import threading
import uuid
from collections import OrderedDict

import numpy as np
from PIL import Image

from ..core.forensics import block_features, to_rgb8
from ..core.io import LoadedImage

MAX_IMAGES = 8
MAX_RENDERS_PER_IMAGE = 32

# Above this size the image is downscaled for analysis. Downscaling erases
# compression and noise traces, so the UI warns when it happens; the cap keeps
# a 50 MP photo from taking a minute per view.
MAX_ANALYSIS_DIM = 4096


def _prepare(pixels: np.ndarray, meta: dict) -> np.ndarray:
    rgb8 = to_rgb8(pixels)
    h, w = rgb8.shape[:2]
    long_side = max(h, w)
    meta["downscaled_for_analysis"] = long_side > MAX_ANALYSIS_DIM
    if long_side > MAX_ANALYSIS_DIM:
        scale = MAX_ANALYSIS_DIM / long_side
        size = (max(1, round(w * scale)), max(1, round(h * scale)))
        rgb8 = np.asarray(Image.fromarray(rgb8).resize(size, Image.LANCZOS))
    meta["analysis_width"] = rgb8.shape[1]
    meta["analysis_height"] = rgb8.shape[0]
    return rgb8


class ImageRecord:
    def __init__(self, image: LoadedImage):
        self.meta = image.meta
        self.rgb8 = _prepare(image.pixels, self.meta)
        self._renders: OrderedDict[tuple, bytes] = OrderedDict()
        self._cache: dict[str, object] = {}
        self._lock = threading.Lock()

    def render(self, key: tuple, compute) -> bytes:
        with self._lock:
            if key in self._renders:
                self._renders.move_to_end(key)
                return self._renders[key]
        value = compute()
        with self._lock:
            self._renders[key] = value
            while len(self._renders) > MAX_RENDERS_PER_IMAGE:
                self._renders.popitem(last=False)
        return value

    def cached(self, key: str, compute):
        with self._lock:
            if key in self._cache:
                return self._cache[key]
        value = compute()
        with self._lock:
            self._cache[key] = value
        return value

    def features(self) -> dict:
        return self.cached("block_features", lambda: block_features(self.rgb8))


class ImageStore:
    def __init__(self, max_images: int = MAX_IMAGES):
        self._records: OrderedDict[str, ImageRecord] = OrderedDict()
        self._max = max_images
        self._lock = threading.Lock()

    def add(self, image: LoadedImage) -> tuple[str, ImageRecord]:
        record = ImageRecord(image)
        image_id = uuid.uuid4().hex[:12]
        with self._lock:
            self._records[image_id] = record
            while len(self._records) > self._max:
                self._records.popitem(last=False)
        return image_id, record

    def get(self, image_id: str) -> ImageRecord | None:
        with self._lock:
            record = self._records.get(image_id)
            if record is not None:
                self._records.move_to_end(image_id)
            return record
