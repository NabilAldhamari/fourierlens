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

_WINDOWS_1D = {
    "hann": lambda n: _sw.hann(n, sym=False),
    "hamming": lambda n: _sw.hamming(n, sym=False),
    "blackman": lambda n: _sw.blackman(n, sym=False),
    "tukey": lambda n: _sw.tukey(n, alpha=0.5, sym=False),
}
WINDOW_NAMES = ("none", *_WINDOWS_1D)


@lru_cache(maxsize=32)
def get_window_2d(name: str, height: int, width: int) -> np.ndarray | None:
    """Return an HxW float32 window, or None for 'none' (identity)."""
    if name == "none":
        return None
    if name not in _WINDOWS_1D:
        raise ValueError(f"Unknown window {name!r}; expected one of {WINDOW_NAMES}")
    window_1d = _WINDOWS_1D[name]
    return np.outer(window_1d(height), window_1d(width)).astype(np.float32)


def apply_window(img2d: np.ndarray, name: str) -> np.ndarray:
    win = get_window_2d(name, img2d.shape[0], img2d.shape[1])
    return img2d if win is None else img2d * win
