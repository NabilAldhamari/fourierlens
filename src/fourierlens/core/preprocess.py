"""Optional preprocessing applied to a channel *before* frequency analysis.

Pre-filtering often makes spectral structure easier to see: edge extraction
strips smooth shading so periodic texture stands out; equalization normalizes
exposure differences across a dataset; blur suppresses noise that would
otherwise flood the high frequencies.

All ops take and return a float32 image in [0, 1]. `amount` is a unitless
strength in [0, 3] (1 = the op's natural default), so the UI can expose a
single slider for every op.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

# op key -> (label, uses_amount, plain-language description for tooltips)
PREPROCESS_OPS: dict[str, tuple[str, bool, str]] = {
    "none": ("None", False, "Analyze the image exactly as loaded."),
    "equalize": (
        "Histogram equalize",
        False,
        "Spreads brightness values evenly. Use when the image is very dark/bright or when "
        "comparing images with different exposure - it removes global contrast differences "
        "without touching spatial structure.",
    ),
    "sharpen": (
        "Sharpen (unsharp mask)",
        True,
        "Boosts fine detail before analysis. Useful to make weak high-frequency structure "
        "visible in the spectrum - but remember it inflates high-frequency metrics.",
    ),
    "blur": (
        "Gaussian blur",
        True,
        "Suppresses noise and fine texture so the spectrum shows only coarse structure. "
        "Amount controls the blur radius.",
    ),
    "edges": (
        "Edge magnitude (Sobel)",
        False,
        "Replaces the image with its edge strength. Smooth shading disappears, so periodic "
        "patterns and texture dominate the spectrum - often the best pre-filter for finding "
        "subtle repeating artifacts.",
    ),
    "laplacian": (
        "Laplacian (fine detail)",
        False,
        "Keeps only the finest detail (second derivative). An aggressive high-pass: the "
        "spectrum will show almost exclusively high-frequency content.",
    ),
    "median": (
        "Median denoise",
        True,
        "Removes salt-and-pepper noise while keeping edges sharp. Good before analyzing "
        "scanned or low-light images.",
    ),
    "invert": ("Invert", False, "Inverts brightness. The spectrum magnitude is unchanged except at DC; useful for visual comparison of masks/edges."),
}


def _norm01(arr: np.ndarray) -> np.ndarray:
    lo, hi = float(arr.min()), float(arr.max())
    if hi <= lo:
        return np.zeros_like(arr, dtype=np.float32)
    return ((arr - lo) / (hi - lo)).astype(np.float32)


def apply_preprocess(img2d: np.ndarray, op: str = "none", amount: float = 1.0) -> np.ndarray:
    """Apply one preprocessing op to a 2D float [0,1] channel."""
    img = img2d.astype(np.float32, copy=False)
    amount = float(np.clip(amount, 0.0, 3.0))

    if op == "none" or (op in ("sharpen", "blur", "median") and amount == 0.0):
        return img

    if op == "equalize":
        hist, bin_edges = np.histogram(img, bins=256, range=(0.0, 1.0))
        cdf = np.cumsum(hist).astype(np.float64)
        if cdf[-1] == 0:
            return img
        cdf /= cdf[-1]
        return np.interp(img.ravel(), bin_edges[:-1], cdf).reshape(img.shape).astype(np.float32)

    if op == "sharpen":
        low = ndimage.gaussian_filter(img, sigma=2.0)
        return np.clip(img + 1.5 * amount * (img - low), 0.0, 1.0)

    if op == "blur":
        return ndimage.gaussian_filter(img, sigma=max(0.3, 2.5 * amount))

    if op == "edges":
        gx = ndimage.sobel(img, axis=1)
        gy = ndimage.sobel(img, axis=0)
        return _norm01(np.hypot(gx, gy))

    if op == "laplacian":
        return _norm01(np.abs(ndimage.laplace(img)))

    if op == "median":
        size = 3 if amount <= 1.0 else (5 if amount <= 2.0 else 7)
        return ndimage.median_filter(img, size=size)

    if op == "invert":
        return (1.0 - img).astype(np.float32)

    raise ValueError(f"Unknown preprocess op {op!r}; expected one of {list(PREPROCESS_OPS)}")


def describe_ops() -> dict[str, dict]:
    return {
        key: {"label": label, "uses_amount": uses_amount, "description": desc}
        for key, (label, uses_amount, desc) in PREPROCESS_OPS.items()
    }
