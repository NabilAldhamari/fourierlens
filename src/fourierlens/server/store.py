"""In-memory image store with LRU eviction and per-image FFT caching.

A local single-user tool: no persistence, no auth. Uploaded images and their
computed spectra live in RAM; the FFT cache means dragging a slider only pays
for the inverse transform, not a recompute of the forward one.
"""

from __future__ import annotations

import threading
import uuid
from collections import OrderedDict

import numpy as np

from ..core.fft import compute_fft
from ..core.io import LoadedImage, to_channel
from ..core.preprocess import apply_preprocess

MAX_IMAGES = 16
MAX_FFTS_PER_IMAGE = 4
MAX_CHANNELS_PER_IMAGE = 4

# Interactive analysis cap: FFT/metrics/detectors on a 20+ MP photo take many
# seconds per request and make the UI feel broken. The explorer works on a
# downscaled copy above this size (original dimensions stay in meta; the
# headless CLI/batch pipeline always uses full resolution).
MAX_ANALYSIS_DIM = 2048


def _downscale_for_analysis(pixels, meta: dict):
    h, w = pixels.shape[:2]
    long_side = max(h, w)
    if long_side <= MAX_ANALYSIS_DIM:
        meta["analysis_width"] = w
        meta["analysis_height"] = h
        meta["downscaled_for_analysis"] = False
        return pixels
    from PIL import Image as _PILImage

    scale = MAX_ANALYSIS_DIM / long_side
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    arr8 = (np.clip(pixels, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    mode = "RGB" if arr8.ndim == 3 else "L"
    small = _PILImage.fromarray(arr8, mode=mode).resize((nw, nh), _PILImage.LANCZOS)
    meta["analysis_width"] = nw
    meta["analysis_height"] = nh
    meta["downscaled_for_analysis"] = True
    return np.asarray(small, dtype=np.float32) / 255.0


class ImageRecord:
    def __init__(self, image: LoadedImage):
        self.meta = image.meta
        self.pixels = _downscale_for_analysis(image.pixels, self.meta)
        self._ffts: OrderedDict[tuple, np.ndarray] = OrderedDict()
        self._channels: OrderedDict[tuple, np.ndarray] = OrderedDict()
        self._analysis: dict[str, object] = {}
        self._lock = threading.Lock()

    def channel(self, mode: str, preprocess: str = "none", pre_amount: float = 1.0) -> np.ndarray:
        """Channel extraction + optional pre-filter, cached (pre-filters are the
        analysis input everywhere, so they must be identical across endpoints)."""
        key = (mode, preprocess, round(float(pre_amount), 3))
        with self._lock:
            if key in self._channels:
                self._channels.move_to_end(key)
                return self._channels[key]
        img2d = apply_preprocess(to_channel(self.pixels, mode), preprocess, pre_amount)
        with self._lock:
            self._channels[key] = img2d
            self._channels.move_to_end(key)
            while len(self._channels) > MAX_CHANNELS_PER_IMAGE:
                self._channels.popitem(last=False)
        return img2d

    def fft(self, channel: str, window: str, preprocess: str = "none", pre_amount: float = 1.0) -> np.ndarray:
        key = (channel, window, preprocess, round(float(pre_amount), 3))
        with self._lock:
            if key in self._ffts:
                self._ffts.move_to_end(key)
                return self._ffts[key]
        F = compute_fft(self.channel(channel, preprocess, pre_amount), window)
        with self._lock:
            self._ffts[key] = F
            self._ffts.move_to_end(key)
            while len(self._ffts) > MAX_FFTS_PER_IMAGE:
                self._ffts.popitem(last=False)
        return F

    def analysis_cache(self, key: str, compute):
        with self._lock:
            if key in self._analysis:
                return self._analysis[key]
        value = compute()
        with self._lock:
            self._analysis[key] = value
        return value


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
            self._records.move_to_end(image_id)
            while len(self._records) > self._max:
                self._records.popitem(last=False)
        return image_id, record

    def get(self, image_id: str) -> ImageRecord | None:
        with self._lock:
            record = self._records.get(image_id)
            if record is not None:
                self._records.move_to_end(image_id)
            return record
