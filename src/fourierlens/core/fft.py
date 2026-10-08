"""Spectra, band-energy maps, and filtered reconstructions.

Conventions used throughout:
- Complex spectra ``F`` are stored *unshifted* (DC at index [0, 0]) as returned
  by ``np.fft.fft2``. Anything meant for display or user coordinates is
  fftshifted at the edge of this module.
- Display arrays are float32 in [0, 1] or uint8 in [0, 255].
- Normalized frequency coordinates: after fftshift, a pixel (row, col) in an
  HxW spectrum maps to fx = (col - W//2) / (W/2), fy = (row - H//2) / (H/2),
  so fx/fy are in [-1, 1] with 1 = Nyquist along that axis.
"""

from __future__ import annotations

import numpy as np

from .windows import apply_window

SCALE_MODES = ("log", "linear", "gamma")


def compute_fft(img2d: np.ndarray, window: str = "none") -> np.ndarray:
    """FFT of a single channel, unshifted, complex64."""
    return np.fft.fft2(apply_window(img2d.astype(np.float32), window)).astype(np.complex64)


def normalized_freq_grid(shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """(fy, fx) grids for a *shifted* spectrum, each in [-1, 1] with 1 = Nyquist."""
    h, w = shape
    fy = (np.arange(h, dtype=np.float32) - h // 2) / (h / 2.0)
    fx = (np.arange(w, dtype=np.float32) - w // 2) / (w / 2.0)
    return fy[:, None], fx[None, :]


def radius_grid(shape: tuple[int, int]) -> np.ndarray:
    """Normalized radial frequency (0 = DC, 1 = Nyquist) for a shifted spectrum."""
    fy, fx = normalized_freq_grid(shape)
    return np.hypot(fy, fx)


def scale_magnitude(
    mag: np.ndarray,
    scale: str = "log",
    gamma: float = 0.5,
    clip_lo: float = 0.1,
    clip_hi: float = 99.9,
) -> np.ndarray:
    """Map a non-negative magnitude/power array to display floats in [0, 1].

    clip_lo / clip_hi are percentiles applied after the log/gamma transfer curve,
    so outlier bins (like DC) do not crush the rest of the spectrum to black.
    """
    if scale == "log":
        x = np.log1p(mag)
    elif scale == "gamma":
        x = np.power(np.maximum(mag, 0.0), max(gamma, 1e-3))
    elif scale == "linear":
        x = mag
    else:
        raise ValueError(f"Unknown scale {scale!r}; expected one of {SCALE_MODES}")
    lo, hi = np.percentile(x, [clip_lo, clip_hi])
    if hi <= lo:
        hi = lo + 1e-9
    return np.clip((x - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def to_uint8(x01: np.ndarray) -> np.ndarray:
    return (np.clip(x01, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def magnitude_display(
    F: np.ndarray,
    scale: str = "log",
    gamma: float = 0.5,
    clip_lo: float = 0.1,
    clip_hi: float = 99.9,
    shifted: bool = True,
) -> np.ndarray:
    """uint8 magnitude spectrum image (shifted so DC is centered by default)."""
    mag = np.abs(np.fft.fftshift(F) if shifted else F)
    return to_uint8(scale_magnitude(mag, scale, gamma, clip_lo, clip_hi))


def power_spectrum(F: np.ndarray) -> np.ndarray:
    """Shifted power spectral density |F|^2 / N as float64 (for metrics)."""
    return (np.abs(np.fft.fftshift(F)).astype(np.float64) ** 2) / F.size
