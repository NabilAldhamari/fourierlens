"""2D separable window functions.

Windowing tapers image borders toward zero before the FFT. Without it, the FFT
treats the image as tiling infinitely, and the mismatch between opposite edges
shows up as a bright horizontal/vertical "cross" through the spectrum center
that has nothing to do with the image content.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np
from scipy.signal import windows as _sw

WINDOW_NAMES = ("none", "hann", "hamming", "blackman", "tukey")

_DESCRIPTIONS = {
    "none": "No tapering. Fast, but edge wrap-around adds a spurious axis-aligned cross to the spectrum.",
    "hann": "Cosine taper to zero at the borders. Good default for spectrum inspection.",
    "hamming": "Cosine taper that does not quite reach zero; slightly better frequency resolution, more leakage.",
    "blackman": "Strong taper with very low leakage; blurs frequency resolution slightly.",
    "tukey": "Flat center with cosine-tapered edges (alpha=0.5); preserves most image energy.",
}


def _window_1d(name: str, n: int) -> np.ndarray:
    if name == "hann":
        return _sw.hann(n, sym=False)
    if name == "hamming":
        return _sw.hamming(n, sym=False)
    if name == "blackman":
        return _sw.blackman(n, sym=False)
    if name == "tukey":
        return _sw.tukey(n, alpha=0.5, sym=False)
    raise ValueError(f"Unknown window {name!r}; expected one of {WINDOW_NAMES}")


@lru_cache(maxsize=32)
def get_window_2d(name: str, height: int, width: int) -> np.ndarray | None:
    """Return an HxW float32 window, or None for 'none' (identity)."""
    if name == "none":
        return None
    wy = _window_1d(name, height)
    wx = _window_1d(name, width)
    return np.outer(wy, wx).astype(np.float32)


def apply_window(img2d: np.ndarray, name: str) -> np.ndarray:
    win = get_window_2d(name, img2d.shape[0], img2d.shape[1])
    return img2d if win is None else img2d * win


def describe_windows() -> dict[str, str]:
    return dict(_DESCRIPTIONS)
