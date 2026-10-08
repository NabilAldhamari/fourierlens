"""Automatic spectral anomaly detectors.

Every detector returns dicts shaped like:

    {
      "type": "periodic_noise",
      "severity": 0.0-1.0,
      "title": "...",
      "explanation": "plain-language paragraph",
      "locations": [{"x": .., "y": ..}, ...]   # normalized shifted-spectrum canvas coords
      ...detector-specific extras...
    }

Locations use the same normalized canvas coordinates as mask specs, so the UI
can draw markers directly on the spectrum and users can convert a flag into a
highlight/annotation with one click.
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import label as nd_label
from scipy.ndimage import maximum_filter

from .fft import compute_fft, power_spectrum, radius_grid
from .metrics import radial_profile, spectral_slope


def _sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-x)))


def _residual_spectrum(psd: np.ndarray) -> np.ndarray:
    """Log10-PSD minus its expected radial baseline, median-centered.

    Units are *decades above the azimuthal norm at that radius*. For a clean
    (stochastic) image, periodogram bins follow an exponential distribution,
    so the maximum residual over the whole plane stays near
    log10(ln(N)) + 0.16 ≈ 1.2 decades. Anything much above that is a genuine
    concentration of energy, not sampling noise.
    """
    log_psd = np.log10(psd + 1e-20)
    r = radius_grid(psd.shape)
    freqs, prof = radial_profile(psd, nbins=128)
    baseline = np.interp(r, freqs, np.log10(prof + 1e-20))
    residual = log_psd - baseline
    return residual - float(np.median(residual))


def detect_spectral_peaks(psd: np.ndarray, threshold_decades: float = 1.5, max_peaks: int = 12) -> list[dict]:
    """Isolated spectral peaks well above the radial baseline.

    These indicate energy concentrated at one exact frequency+orientation:
    periodic noise, moire patterns, sensor interference, or halftone screens.
    """
    h, w = psd.shape
    residual = _residual_spectrum(psd)
    r = radius_grid(psd.shape)

    strong = residual > threshold_decades
    strong &= r > 0.04  # exclude DC neighborhood
    # exclude the axis cross (windowing residue / image gradients live there)
    cy, cx = h // 2, w // 2
    strong[max(cy - 1, 0) : cy + 2, :] = False
    strong[:, max(cx - 1, 0) : cx + 2] = False

    is_max = maximum_filter(residual, size=5) == residual
    candidates = strong & is_max
    if not candidates.any():
        return []

    labels, n = nd_label(strong)
    peaks = []
    seen: set[tuple[int, int]] = set()
    ys, xs = np.nonzero(candidates)
    order = np.argsort(residual[ys, xs])[::-1]
    for i in order:
        y, x = int(ys[i]), int(xs[i])
        lab = labels[y, x]
        key = (lab, 0)
        if lab and key in seen:
            continue
        # keep one of each conjugate pair (upper half-plane)
        fy, fx = (y - cy) / (h / 2.0), (x - cx) / (w / 2.0)
        if fy > 0 or (fy == 0 and fx < 0):
            continue
        seen.add(key)
        cyc = float(np.hypot(fx, fy)) * 0.5
        peaks.append(
            {
                "x": round((x + 0.5) / w, 4),
                "y": round((y + 0.5) / h, 4),
                "fx": round(fx, 4),
                "fy": round(fy, 4),
                "cycles_per_px": round(cyc, 5),
                "wavelength_px": round(1.0 / cyc, 1) if cyc > 1e-9 else None,
                "orientation_deg": round(float(np.degrees(np.arctan2(fy, fx))) % 180.0, 1),
                "strength_decades": round(float(residual[y, x]), 2),
            }
        )
        if len(peaks) >= max_peaks:
            break
    return peaks


def detect_jpeg_grid(psd: np.ndarray) -> dict | None:
    """Energy at multiples of N/8 along both axes = 8x8 block-DCT fingerprint.

    Individual grid harmonics are weaker than free-standing peaks, but they sit
    at *known* locations, so the joint evidence of the strongest 8 of the 48
    candidate sites each being several times above baseline is decisive.
    """
    h, w = psd.shape
    residual = _residual_spectrum(psd)
    cy, cx = h // 2, w // 2
    scores = []
    for ky in range(-3, 4):
        for kx in range(-3, 4):
            if kx == 0 and ky == 0:
                continue
            y, x = cy + ky * h // 8, cx + kx * w // 8
            if 1 <= y < h - 1 and 1 <= x < w - 1:
                scores.append(float(residual[y - 1 : y + 2, x - 1 : x + 2].max()))
    if not scores:
        return None
    top8_decades = float(np.mean(sorted(scores, reverse=True)[:8]))
    if top8_decades < 0.8:
        return None
    return {"grid_strength_decades": round(top8_decades, 2), "severity": _sigmoid((top8_decades - 1.4) / 0.4)}


def detect_all(img2d: np.ndarray) -> list[dict]:
    """Run every detector on one channel; returns flags sorted by severity."""
    # Mean-subtracted so DC leakage doesn't skew the radial baseline (see metrics.py).
    F = compute_fft(img2d - float(img2d.mean()), window="hann")
    psd = power_spectrum(F)
    freqs, prof = radial_profile(psd, nbins=128)
    alpha, r2 = spectral_slope(freqs, prof)
    r = radius_grid(psd.shape)
    valid = (r > 0) & (r <= 1.0)
    total = float(psd[valid].sum()) or 1e-12
    hf_ratio = float(psd[valid & (r > 0.5)].sum() / total)

    flags: list[dict] = []

    peaks = detect_spectral_peaks(psd)
    if peaks:
        axis_peaks = [p for p in peaks if abs(p["fx"]) < 0.02 or abs(p["fy"]) < 0.02]
        other_peaks = [p for p in peaks if p not in axis_peaks]
        if other_peaks:
            top = max(p["strength_decades"] for p in other_peaks)
            flags.append(
                {
                    "type": "periodic_noise",
                    "severity": _sigmoid((top - 2.2) / 0.5),
                    "title": f"Repeating pattern ({len(other_peaks)} spectral peak{'s' if len(other_peaks) != 1 else ''})",
                    "explanation": (
                        "Bright isolated points in the spectrum mean a pattern that repeats at one exact "
                        "spacing and angle. Upsampling layers in image generators leave such grids. So do "
                        "moire, printing screens, sensor interference and regular textures like fabric."
                    ),
                    "locations": [{"x": p["x"], "y": p["y"]} for p in other_peaks],
                    "peaks": other_peaks,
                }
            )
        if axis_peaks:
            flags.append(
                {
                    "type": "axis_aligned_peaks",
                    "severity": _sigmoid((max(p["strength_decades"] for p in axis_peaks) - 2.5) / 0.6),
                    "title": f"Row or column pattern ({len(axis_peaks)} peak{'s' if len(axis_peaks) != 1 else ''})",
                    "explanation": (
                        "Peaks on the horizontal or vertical axis of the spectrum mean something repeats "
                        "along rows or columns. Resizing and upsampling leave this, often at simple "
                        "fractions such as 1/2 or 1/4 cycles per pixel. Sensor banding does too."
                    ),
                    "locations": [{"x": p["x"], "y": p["y"]} for p in axis_peaks],
                    "peaks": axis_peaks,
                }
            )

    jpeg = detect_jpeg_grid(psd)
    if jpeg:
        flags.append(
            {
                "type": "jpeg_grid",
                "severity": jpeg["severity"],
                "title": "JPEG 8×8 block-compression fingerprint",
                "explanation": (
                    "Regular energy at multiples of 1/8 cycles per pixel is the signature of JPEG's 8×8 "
                    "blocks. The image was JPEG-compressed at some point, even if it is now another format."
                ),
                "grid_strength_decades": jpeg["grid_strength_decades"],
                "locations": [],
            }
        )

    if np.isfinite(alpha) and r2 > 0.5:
        if alpha < 1.0:
            flags.append(
                {
                    "type": "excess_high_frequency",
                    "severity": _sigmoid((1.0 - alpha) * 3.0),
                    "title": f"Unnaturally flat spectrum (α = {alpha:.2f})",
                    "explanation": (
                        "In natural photos, power falls smoothly towards fine detail (α ≈ 2). Here it "
                        "barely falls, so there is excess fine-grain energy. Generators often leave this, "
                        "and so do heavy sharpening and added noise."
                    ),
                    "alpha": round(alpha, 3),
                    "locations": [],
                }
            )
        elif alpha > 3.3:
            flags.append(
                {
                    "type": "low_detail",
                    "severity": _sigmoid((alpha - 3.8) * 2.0),
                    "title": f"Very steep spectral falloff (α = {alpha:.2f})",
                    "explanation": (
                        "Fine detail fades much faster than in natural photos (α ≈ 2). The image was "
                        "probably upscaled from a lower resolution, or blurred or heavily denoised."
                    ),
                    "alpha": round(alpha, 3),
                    "locations": [],
                }
            )

    if hf_ratio > 0.35:
        flags.append(
            {
                "type": "high_hf_energy",
                "severity": _sigmoid((hf_ratio - 0.45) * 12.0),
                "title": f"High-frequency energy ratio {hf_ratio:.0%}",
                "explanation": (
                    "More than a third of the image's energy is in the finest detail. Typical photos keep "
                    "this under 10%. Strong noise, dithering or synthetic texture cause it."
                ),
                "hf_ratio": round(hf_ratio, 4),
                "locations": [],
            }
        )

    flags.sort(key=lambda f: f["severity"], reverse=True)
    return flags
