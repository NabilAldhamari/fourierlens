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

MAX_IMAGES = 16
MAX_FFTS_PER_IMAGE = 4


class ImageRecord:
    def __init__(self, image: LoadedImage):
        self.pixels = image.pixels
        self.meta = image.meta
        self._ffts: OrderedDict[tuple[str, str], np.ndarray] = OrderedDict()
        self._analysis: dict[str, object] = {}
        self._lock = threading.Lock()

    def channel(self, mode: str) -> np.ndarray:
        return to_channel(self.pixels, mode)

    def fft(self, channel: str, window: str) -> np.ndarray:
        key = (channel, window)
        with self._lock:
            if key in self._ffts:
                self._ffts.move_to_end(key)
                return self._ffts[key]
        F = compute_fft(self.channel(channel), window)
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
