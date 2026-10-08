"""Automatic spectral anomaly detectors.

Every flag is a dict shaped like:

    {
      "type": "periodic_noise",
      "severity": 0.0-1.0,
      "title": "...",
      "explanation": "plain-language paragraph",
      "locations": [{"x": .., "y": ..}, ...]   # normalized shifted-spectrum canvas coords
      ...detector-specific extras...
    }

Locations use normalized canvas coordinates, so the UI can draw markers
directly on the spectrum.
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import label as nd_label
from scipy.ndimage import maximum_filter

from .fft import compute_fft, power_spectrum, radius_grid
from .metrics import radial_profile, spectral_slope

PROFILE_BINS = 128
DC_RADIUS = 0.04  # normalized radius around DC that peak detection ignores
AXIS_TOLERANCE = 0.02  # |fx| or |fy| below this counts as on-axis
HIGH_FREQ_RADIUS = 0.5
NATURAL_ALPHA_MIN = 1.0  # flatter falloff than this = excess fine-grain energy
NATURAL_ALPHA_MAX = 3.3  # steeper falloff than this = missing detail
MIN_SLOPE_R2 = 0.5
HF_RATIO_LIMIT = 0.35
JPEG_GRID_MIN_DECADES = 0.8
EPS = 1e-20


def detect_all(img2d: np.ndarray) -> list[dict]:
    """Run every detector on one channel; returns flags sorted by severity."""
    # Mean-subtracted so DC leakage doesn't skew the radial baseline (see metrics.py).
    psd = power_spectrum(compute_fft(img2d - float(img2d.mean()), window="hann"))
    flags = [
        *_peak_flags(psd),
        *_jpeg_grid_flags(psd),
        *_slope_flags(psd),
        *_hf_energy_flags(psd),
    ]
    flags.sort(key=lambda f: f["severity"], reverse=True)
    return flags


def _peak_flags(psd: np.ndarray) -> list[dict]:
    peaks = detect_spectral_peaks(psd)
    axis_peaks = [p for p in peaks if abs(p["fx"]) < AXIS_TOLERANCE or abs(p["fy"]) < AXIS_TOLERANCE]
    other_peaks = [p for p in peaks if p not in axis_peaks]
    flags = []
    if other_peaks:
        flags.append(_peak_flag(
            other_peaks, "periodic_noise", center=2.2, width=0.5,
            title=f"Repeating pattern ({_count(len(other_peaks), 'spectral peak')})",
            explanation=(
                "Bright isolated points in the spectrum mean a pattern that repeats at one exact "
                "spacing and angle. Upsampling layers in image generators leave such grids. So do "
                "moire, printing screens, sensor interference and regular textures like fabric."
            ),
        ))
    if axis_peaks:
        flags.append(_peak_flag(
            axis_peaks, "axis_aligned_peaks", center=2.5, width=0.6,
            title=f"Row or column pattern ({_count(len(axis_peaks), 'peak')})",
            explanation=(
                "Peaks on the horizontal or vertical axis of the spectrum mean something repeats "
                "along rows or columns. Resizing and upsampling leave this, often at simple "
                "fractions such as 1/2 or 1/4 cycles per pixel. Sensor banding does too."
            ),
        ))
    return flags


def _peak_flag(peaks: list[dict], kind: str, center: float, width: float, title: str, explanation: str) -> dict:
    strongest = max(p["strength_decades"] for p in peaks)
    return {
        "type": kind,
        "severity": _sigmoid((strongest - center) / width),
        "title": title,
        "explanation": explanation,
        "locations": [{"x": p["x"], "y": p["y"]} for p in peaks],
        "peaks": peaks,
    }


def _jpeg_grid_flags(psd: np.ndarray) -> list[dict]:
    jpeg = detect_jpeg_grid(psd)
    if not jpeg:
        return []
    return [{
        "type": "jpeg_grid",
        "severity": jpeg["severity"],
        "title": "JPEG 8×8 block-compression fingerprint",
        "explanation": (
            "Regular energy at multiples of 1/8 cycles per pixel is the signature of JPEG's 8×8 "
            "blocks. The image was JPEG-compressed at some point, even if it is now another format."
        ),
        "grid_strength_decades": jpeg["grid_strength_decades"],
        "locations": [],
    }]


def _slope_flags(psd: np.ndarray) -> list[dict]:
    alpha, r2 = spectral_slope(*radial_profile(psd, nbins=PROFILE_BINS))
    if not np.isfinite(alpha) or r2 <= MIN_SLOPE_R2:
        return []
    if alpha < NATURAL_ALPHA_MIN:
        return [{
            "type": "excess_high_frequency",
            "severity": _sigmoid((NATURAL_ALPHA_MIN - alpha) * 3.0),
            "title": f"Unnaturally flat spectrum (α = {alpha:.2f})",
            "explanation": (
                "In natural photos, power falls smoothly towards fine detail (α ≈ 2). Here it "
                "barely falls, so there is excess fine-grain energy. Generators often leave this, "
                "and so do heavy sharpening and added noise."
            ),
            "alpha": round(alpha, 3),
            "locations": [],
        }]
    if alpha > NATURAL_ALPHA_MAX:
        return [{
            "type": "low_detail",
            "severity": _sigmoid((alpha - 3.8) * 2.0),
            "title": f"Very steep spectral falloff (α = {alpha:.2f})",
            "explanation": (
                "Fine detail fades much faster than in natural photos (α ≈ 2). The image was "
                "probably upscaled from a lower resolution, or blurred or heavily denoised."
            ),
            "alpha": round(alpha, 3),
            "locations": [],
        }]
    return []


def _hf_energy_flags(psd: np.ndarray) -> list[dict]:
    r = radius_grid(psd.shape)
    valid = (r > 0) & (r <= 1.0)
    total = float(psd[valid].sum()) or 1e-12
    hf_ratio = float(psd[valid & (r > HIGH_FREQ_RADIUS)].sum() / total)
    if hf_ratio <= HF_RATIO_LIMIT:
        return []
    return [{
        "type": "high_hf_energy",
        "severity": _sigmoid((hf_ratio - 0.45) * 12.0),
        "title": f"High-frequency energy ratio {hf_ratio:.0%}",
        "explanation": (
            "More than a third of the image's energy is in the finest detail. Typical photos keep "
            "this under 10%. Strong noise, dithering or synthetic texture cause it."
        ),
        "hf_ratio": round(hf_ratio, 4),
        "locations": [],
    }]


def detect_spectral_peaks(psd: np.ndarray, threshold_decades: float = 1.5, max_peaks: int = 12) -> list[dict]:
    """Isolated spectral peaks well above the radial baseline.

    These indicate energy concentrated at one exact frequency+orientation:
    periodic noise, moire patterns, sensor interference, or halftone screens.
    """
    h, w = psd.shape
    cy, cx = h // 2, w // 2
    residual = _residual_spectrum(psd)

    strong = (residual > threshold_decades) & (radius_grid(psd.shape) > DC_RADIUS)
    # exclude the axis cross (windowing residue / image gradients live there)
    strong[max(cy - 1, 0) : cy + 2, :] = False
    strong[:, max(cx - 1, 0) : cx + 2] = False

    candidates = strong & (maximum_filter(residual, size=5) == residual)
    labels, _ = nd_label(strong)
    ys, xs = np.nonzero(candidates)
    peaks = []
    seen_labels: set[int] = set()
    for i in np.argsort(residual[ys, xs])[::-1]:
        y, x = int(ys[i]), int(xs[i])
        fy, fx = (y - cy) / (h / 2.0), (x - cx) / (w / 2.0)
        is_conjugate = fy > 0 or (fy == 0 and fx < 0)  # keep the upper half-plane twin only
        if labels[y, x] in seen_labels or is_conjugate:
            continue
        seen_labels.add(labels[y, x])
        peaks.append(_describe_peak(x, y, fx, fy, w, h, float(residual[y, x])))
        if len(peaks) >= max_peaks:
            break
    return peaks


def _describe_peak(x: int, y: int, fx: float, fy: float, w: int, h: int, strength: float) -> dict:
    cycles = float(np.hypot(fx, fy)) * 0.5
    return {
        "x": round((x + 0.5) / w, 4),
        "y": round((y + 0.5) / h, 4),
        "fx": round(fx, 4),
        "fy": round(fy, 4),
        "cycles_per_px": round(cycles, 5),
        "wavelength_px": round(1.0 / cycles, 1) if cycles > 1e-9 else None,
        "orientation_deg": round(float(np.degrees(np.arctan2(fy, fx))) % 180.0, 1),
        "strength_decades": round(strength, 2),
    }


def detect_jpeg_grid(psd: np.ndarray) -> dict | None:
    """Energy at multiples of N/8 along both axes = 8x8 block-DCT fingerprint.

    Individual grid harmonics are weaker than free-standing peaks, but they sit
    at *known* locations, so the joint evidence of the strongest 8 of the 48
    candidate sites each being several times above baseline is decisive.
    """
    h, w = psd.shape
    cy, cx = h // 2, w // 2
    residual = _residual_spectrum(psd)
    scores = []
    for ky in range(-3, 4):
        for kx in range(-3, 4):
            y, x = cy + ky * h // 8, cx + kx * w // 8
            if (kx or ky) and 1 <= y < h - 1 and 1 <= x < w - 1:
                scores.append(float(residual[y - 1 : y + 2, x - 1 : x + 2].max()))
    if not scores:
        return None
    top8_decades = float(np.mean(sorted(scores, reverse=True)[:8]))
    if top8_decades < JPEG_GRID_MIN_DECADES:
        return None
    return {"grid_strength_decades": round(top8_decades, 2), "severity": _sigmoid((top8_decades - 1.4) / 0.4)}


def _residual_spectrum(psd: np.ndarray) -> np.ndarray:
    """Log10-PSD minus its expected radial baseline, median-centered.

    Units are *decades above the azimuthal norm at that radius*. For a clean
    (stochastic) image, periodogram bins follow an exponential distribution,
    so the maximum residual over the whole plane stays near
    log10(ln(N)) + 0.16 ≈ 1.2 decades. Anything much above that is a genuine
    concentration of energy, not sampling noise.
    """
    freqs, prof = radial_profile(psd, nbins=PROFILE_BINS)
    baseline = np.interp(radius_grid(psd.shape), freqs, np.log10(prof + EPS))
    residual = np.log10(psd + EPS) - baseline
    return residual - float(np.median(residual))


def _sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-x)))


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}{'' if n == 1 else 's'}"
