"""Spectral metrics for research export.

All metrics operate on the shifted power spectral density of a single channel.
Frequencies are normalized so 1.0 = Nyquist. DC is excluded everywhere it
would dominate. Every public metric is a plain float / list so results
serialize straight to JSON, CSV, or Parquet.
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import laplace

from .fft import compute_fft, normalized_freq_grid, power_spectrum, radius_grid


def radial_profile(psd: np.ndarray, nbins: int = 64) -> tuple[np.ndarray, np.ndarray]:
    """Azimuthally averaged power: (bin center freqs, mean power per annulus).

    The 1D radial profile is the standard summary used to compare datasets and
    detect synthetic-image fingerprints.
    """
    r = radius_grid(psd.shape)
    valid = (r > 0) & (r <= 1.0)
    bins = np.linspace(0.0, 1.0, nbins + 1)
    idx = np.clip(np.digitize(r[valid], bins) - 1, 0, nbins - 1)
    sums = np.bincount(idx, weights=psd[valid], minlength=nbins)
    counts = np.maximum(np.bincount(idx, minlength=nbins), 1)
    centers = (bins[:-1] + bins[1:]) / 2.0
    return centers, sums / counts


def spectral_slope(freqs: np.ndarray, power: np.ndarray, fmin: float = 0.02, fmax: float = 0.7) -> tuple[float, float]:
    """Fit P(f) ~ 1/f^alpha over the mid band; returns (alpha, r_squared)."""
    sel = (freqs >= fmin) & (freqs <= fmax) & (power > 0)
    if sel.sum() < 4:
        return float("nan"), 0.0
    lx, ly = np.log(freqs[sel]), np.log(power[sel])
    slope, intercept = np.polyfit(lx, ly, 1)
    pred = slope * lx + intercept
    ss_res = float(np.sum((ly - pred) ** 2))
    ss_tot = float(np.sum((ly - ly.mean()) ** 2)) or 1e-12
    return float(-slope), max(0.0, 1.0 - ss_res / ss_tot)


def orientation_histogram(psd: np.ndarray, nbins: int = 36, rmin: float = 0.02) -> np.ndarray:
    """Energy per orientation bin over [0, 180) degrees, normalized to sum 1."""
    fy, fx = normalized_freq_grid(psd.shape)
    r = np.hypot(fy, fx)
    valid = (r >= rmin) & (r <= 1.0)
    ang = np.degrees(np.arctan2(fy, fx)) % 180.0
    idx = np.clip((ang[valid] / 180.0 * nbins).astype(int), 0, nbins - 1)
    hist = np.bincount(idx, weights=psd[valid], minlength=nbins)
    total = hist.sum() or 1.0
    return hist / total


def compute_metrics(img2d: np.ndarray, nbins: int = 64) -> dict:
    """All scalar metrics plus the radial and orientation profiles for one channel."""
    # Mean-subtract, then window: otherwise DC leaks through the window's main
    # lobe into low-frequency bins and dominates every energy statistic.
    F = compute_fft(img2d - float(img2d.mean()), window="hann")
    psd = power_spectrum(F)
    r = radius_grid(psd.shape)
    valid = (r > 0) & (r <= 1.0)
    p = psd[valid]
    rv = r[valid]
    total = p.sum() or 1e-12

    freqs, prof = radial_profile(psd, nbins)
    alpha, r2 = spectral_slope(freqs, prof)

    pn = p / total
    entropy = float(-(pn * np.log(pn + 1e-20)).sum() / np.log(pn.size))
    flatness = float(np.exp(np.mean(np.log(p + 1e-20))) / (p.mean() + 1e-20))

    centroid = float((rv * p).sum() / total)
    bandwidth = float(np.sqrt(((rv - centroid) ** 2 * p).sum() / total))

    ohist = orientation_histogram(psd, rmin=0.02)
    dom_idx = int(np.argmax(ohist))
    dominant_deg = (dom_idx + 0.5) * 180.0 / ohist.size
    anisotropy = float(ohist.max() * ohist.size - 1.0)  # 0 for perfectly flat histogram

    lap = laplace(img2d.astype(np.float64))
    mean_i = float(img2d.mean())
    std_i = float(img2d.std())

    return {
        "spectral_slope": round(alpha, 4),
        "slope_r2": round(r2, 4),
        "hf_energy_ratio": round(float(p[rv > 0.5].sum() / total), 6),
        "mf_energy_ratio": round(float(p[(rv > 0.1) & (rv <= 0.5)].sum() / total), 6),
        "spectral_centroid": round(centroid, 5),
        "spectral_bandwidth": round(bandwidth, 5),
        "spectral_entropy": round(entropy, 5),
        "spectral_flatness": round(flatness, 6),
        "dominant_orientation_deg": round(dominant_deg, 1),
        "orientation_anisotropy": round(anisotropy, 4),
        "blur_score": round(float(lap.var() * 1e4), 4),  # scaled to a readable range
        "mean_intensity": round(mean_i, 5),
        "std_intensity": round(std_i, 5),
        "rms_contrast": round(float(std_i / mean_i) if mean_i > 1e-9 else 0.0, 5),
        "radial_profile": {
            "freqs": [round(float(f), 5) for f in freqs],
            "power": [float(v) for v in prof],
        },
        "orientation_histogram": [round(float(v), 6) for v in ohist],
    }


def scalar_metrics(metrics: dict) -> dict:
    """Strip profile arrays, keeping only scalar columns (for tabular export)."""
    return {k: v for k, v in metrics.items() if not isinstance(v, (list, dict))}
