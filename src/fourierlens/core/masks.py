"""Build frequency-domain masks from JSON-friendly selection specs.

Specs use normalized coordinates on the *shifted* spectrum canvas: x, y in
[0, 1] with (0.5, 0.5) at DC. Radii (r, r_inner, r_outer) are in normalized
frequency units where 1.0 = Nyquist (so a radius is resolution-independent).

Supported spec types:
    {"type": "rect",    "x": .., "y": .., "w": .., "h": ..}
    {"type": "ellipse", "cx": .., "cy": .., "rx": .., "ry": ..}   (canvas units)
    {"type": "annulus", "r_inner": .., "r_outer": ..}             (freq units)
    {"type": "wedge",   "angle_deg": .., "width_deg": ..}         (orientation band)
    {"type": "point",   "x": .., "y": .., "r": ..}                (freq-units radius)
    {"type": "brush",   "points": [[x, y], ...], "r": ..}         (freehand stroke)

Masks returned by :func:`build_mask` are float32 in [0, 1], *unshifted* (ready
to multiply with an unshifted spectrum), and conjugate-symmetric by default so
that a masked inverse FFT stays real.
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

from .fft import normalized_freq_grid


def _canvas_grids(shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """(ycanvas, xcanvas) in [0, 1] canvas units for a shifted spectrum."""
    h, w = shape
    y = (np.arange(h, dtype=np.float32) + 0.5) / h
    x = (np.arange(w, dtype=np.float32) + 0.5) / w
    return y[:, None], x[None, :]


def _spec_mask(shape: tuple[int, int], spec: dict) -> np.ndarray:
    h, w = shape
    kind = spec.get("type")
    yc, xc = _canvas_grids(shape)
    fy, fx = normalized_freq_grid(shape)

    if kind == "rect":
        x0, y0 = float(spec["x"]), float(spec["y"])
        x1, y1 = x0 + float(spec["w"]), y0 + float(spec["h"])
        return ((xc >= x0) & (xc <= x1) & (yc >= y0) & (yc <= y1)).astype(np.float32)

    if kind == "ellipse":
        cx, cy = float(spec["cx"]), float(spec["cy"])
        rx, ry = max(float(spec["rx"]), 1e-6), max(float(spec["ry"]), 1e-6)
        return ((((xc - cx) / rx) ** 2 + ((yc - cy) / ry) ** 2) <= 1.0).astype(np.float32)

    if kind == "annulus":
        r = np.hypot(fy, fx)
        ri, ro = float(spec.get("r_inner", 0.0)), float(spec.get("r_outer", 1.0))
        return ((r >= ri) & (r <= ro)).astype(np.float32)

    if kind == "wedge":
        angle = np.degrees(np.arctan2(fy, fx)) % 180.0
        target = float(spec["angle_deg"]) % 180.0
        half = max(float(spec.get("width_deg", 10.0)), 0.1) / 2.0
        diff = np.abs(angle - target)
        diff = np.minimum(diff, 180.0 - diff)
        r = np.hypot(fy, fx)
        return ((diff <= half) & (r > 1e-6)).astype(np.float32)

    if kind == "point":
        px, py = float(spec["x"]), float(spec["y"])
        rad = max(float(spec.get("r", 0.02)), 1e-4)
        pfx, pfy = (px - 0.5) * 2.0, (py - 0.5) * 2.0
        return (np.hypot(fy - pfy, fx - pfx) <= rad).astype(np.float32)

    if kind == "brush":
        pts = spec.get("points") or []
        if not pts:
            return np.zeros(shape, dtype=np.float32)
        rad_freq = max(float(spec.get("r", 0.02)), 1e-4)
        # brush radius in pixels: normalized-frequency radius scaled by min half-dimension
        rad_px = max(int(round(rad_freq * min(h, w) / 2.0)), 1)
        img = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(img)
        xy = [(float(p[0]) * w, float(p[1]) * h) for p in pts]
        if len(xy) == 1:
            x0, y0 = xy[0]
            draw.ellipse([x0 - rad_px, y0 - rad_px, x0 + rad_px, y0 + rad_px], fill=255)
        else:
            draw.line(xy, fill=255, width=2 * rad_px, joint="curve")
            for x0, y0 in (xy[0], xy[-1]):
                draw.ellipse([x0 - rad_px, y0 - rad_px, x0 + rad_px, y0 + rad_px], fill=255)
        return (np.asarray(img, dtype=np.float32) / 255.0 > 0.5).astype(np.float32)

    raise ValueError(f"Unknown mask spec type: {kind!r}")


def conjugate_symmetrize(mask_unshifted: np.ndarray) -> np.ndarray:
    """m[k] := max(m[k], m[-k mod N]) so a masked iFFT stays real."""
    flipped = np.roll(np.flip(mask_unshifted, axis=(0, 1)), shift=(1, 1), axis=(0, 1))
    return np.maximum(mask_unshifted, flipped)


def build_mask(
    shape: tuple[int, int],
    specs: list[dict],
    invert: bool = False,
    symmetric: bool = True,
    soft_px: float = 0.0,
) -> np.ndarray:
    """Union of all specs -> optional invert -> soft edges -> conjugate symmetry.

    Returns a float32 mask in [0, 1], unshifted (DC at [0, 0]).
    """
    shifted = np.zeros(shape, dtype=np.float32)
    for spec in specs:
        shifted = np.maximum(shifted, _spec_mask(shape, spec))
    if invert:
        shifted = 1.0 - shifted
    if soft_px and soft_px > 0:
        shifted = np.clip(gaussian_filter(shifted, sigma=float(soft_px)), 0.0, 1.0)
    mask = np.fft.ifftshift(shifted)
    if symmetric:
        mask = conjugate_symmetrize(mask)
    return mask.astype(np.float32)


def mask_preview(shape: tuple[int, int], specs: list[dict], invert: bool = False, soft_px: float = 0.0) -> np.ndarray:
    """Shifted uint8 preview of the mask for UI display."""
    mask = build_mask(shape, specs, invert=invert, symmetric=True, soft_px=soft_px)
    return (np.fft.fftshift(mask) * 255.0 + 0.5).astype(np.uint8)
