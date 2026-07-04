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


def psd_display(F: np.ndarray, **kwargs) -> np.ndarray:
    """uint8 power spectral density image (|F|^2, log-scaled by default)."""
    psd = np.abs(np.fft.fftshift(F)) ** 2 / F.size
    return to_uint8(scale_magnitude(psd, **kwargs))


def phase_display(F: np.ndarray, shifted: bool = True) -> np.ndarray:
    """uint8 phase image: -pi..pi mapped to 0..255."""
    ph = np.angle(np.fft.fftshift(F) if shifted else F)
    return to_uint8((ph + np.pi) / (2.0 * np.pi))


def power_spectrum(F: np.ndarray) -> np.ndarray:
    """Shifted power spectral density |F|^2 / N as float64 (for metrics)."""
    return (np.abs(np.fft.fftshift(F)).astype(np.float64) ** 2) / F.size


def band_energy_map(F: np.ndarray, mask_unshifted: np.ndarray, clip_hi: float = 99.5) -> np.ndarray:
    """Where does the selected frequency band live in pixel space?

    Inverse-FFT of only the masked frequencies; the magnitude of the resulting
    complex spatial signal is the local band energy (an analytic-signal
    envelope, so it highlights *regions* rather than oscillating with the
    carrier). Returned normalized to [0, 1] for display as an overlay.
    """
    spatial = np.fft.ifft2(F * mask_unshifted)
    energy = np.abs(spatial)
    hi = np.percentile(energy, clip_hi)
    if hi <= 0:
        return np.zeros_like(energy, dtype=np.float32)
    return np.clip(energy / hi, 0.0, 1.0).astype(np.float32)


def masked_reconstruction(F: np.ndarray, mask_unshifted: np.ndarray) -> np.ndarray:
    """Filtered image: iFFT of masked spectrum, real part clipped to [0, 1]."""
    rec = np.fft.ifft2(F * mask_unshifted).real
    return np.clip(rec, 0.0, 1.0).astype(np.float32)


def lowpass_reconstruction(F: np.ndarray, fraction: float) -> np.ndarray:
    """Progressive rebuild: keep radial frequencies up to `fraction` of Nyquist."""
    r = radius_grid(F.shape)
    mask = np.fft.ifftshift((r <= max(float(fraction), 0.0)).astype(np.float32))
    return masked_reconstruction(F, mask)


def patch_spectrum(
    img2d: np.ndarray,
    x: int,
    y: int,
    w: int,
    h: int,
    window: str = "hann",
    out_size: int | None = None,
) -> np.ndarray:
    """Localized spectrum: windowed FFT of a spatial ROI, as uint8 display.

    The patch is windowed (essential: a small crop has strong edge
    discontinuities) and optionally zero-padded to `out_size` so small
    patches still produce a readable spectrum.
    """
    H, W = img2d.shape
    x0, y0 = max(0, int(x)), max(0, int(y))
    x1, y1 = min(W, x0 + max(int(w), 4)), min(H, y0 + max(int(h), 4))
    patch = img2d[y0:y1, x0:x1].astype(np.float32)
    patch = patch - float(patch.mean())  # remove DC so it doesn't dominate a small patch
    patch = apply_window(patch, window)
    if out_size:
        n = max(out_size, patch.shape[0], patch.shape[1])
        padded = np.zeros((n, n), dtype=np.float32)
        oy, ox = (n - patch.shape[0]) // 2, (n - patch.shape[1]) // 2
        padded[oy : oy + patch.shape[0], ox : ox + patch.shape[1]] = patch
        patch = padded
    F = np.fft.fft2(patch)
    return magnitude_display(F)


def spectrum_point_info(shape: tuple[int, int], fx: float, fy: float) -> dict:
    """Human-readable description of one point in the (shifted) spectrum.

    fx, fy are normalized frequencies in [-1, 1] (1 = Nyquist). Returns cycles
    per pixel, wavelength in pixels, and the orientation of the corresponding
    spatial grating (perpendicular to the frequency vector, by convention
    reported as the grating stripe direction).
    """
    h, w = shape
    cyc_x = fx * 0.5  # Nyquist = 0.5 cycles/pixel
    cyc_y = fy * 0.5
    cyc = float(np.hypot(cyc_x, cyc_y))
    wavelength = (1.0 / cyc) if cyc > 1e-9 else float("inf")
    angle = float(np.degrees(np.arctan2(fy, fx))) % 180.0
    return {
        "fx": round(float(fx), 4),
        "fy": round(float(fy), 4),
        "cycles_per_px": round(cyc, 5),
        "wavelength_px": round(wavelength, 2) if np.isfinite(wavelength) else None,
        "orientation_deg": round(angle, 1),
        "period_x_px": round(w / abs(fx * w / 2), 1) if abs(fx) > 1e-9 else None,
        "period_y_px": round(h / abs(fy * h / 2), 1) if abs(fy) > 1e-9 else None,
    }
