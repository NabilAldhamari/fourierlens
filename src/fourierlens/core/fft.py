"""Spectra and frequency grids.

Conventions used throughout:
- Complex spectra ``F`` are stored *unshifted* (DC at index [0, 0]) as returned
  by ``np.fft.fft2``. Anything meant for display or user coordinates is
  fftshifted at the edge of this module.
- Normalized frequency coordinates: after fftshift, a pixel (row, col) in an
  HxW spectrum maps to fx = (col - W//2) / (W/2), fy = (row - H//2) / (H/2),
  so fx/fy are in [-1, 1] with 1 = Nyquist along that axis.
"""

from __future__ import annotations

import numpy as np

from .windows import apply_window


def compute_fft(img2d: np.ndarray, window: str = "none") -> np.ndarray:
    """FFT of a single channel, unshifted, complex64."""
    return np.fft.fft2(apply_window(img2d.astype(np.float32), window)).astype(np.complex64)


def power_spectrum(F: np.ndarray) -> np.ndarray:
    """Shifted power spectral density |F|^2 / N as float64 (for metrics)."""
    return (np.abs(np.fft.fftshift(F)).astype(np.float64) ** 2) / F.size


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


def to_uint8(x01: np.ndarray) -> np.ndarray:
    """Float [0, 1] -> uint8 [0, 255], rounded."""
    return (np.clip(x01, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
