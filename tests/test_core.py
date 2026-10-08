"""Correctness tests for the compute core (math first: FFT, masks, metrics)."""

import io

import numpy as np
import pytest
from PIL import Image

from fourierlens.core import fft as ffx
from fourierlens.core.io import load_image_bytes, to_channel
from fourierlens.core.metrics import compute_metrics, radial_profile, spectral_slope
from fourierlens.core.windows import apply_window, get_window_2d


def make_sinusoid(n=128, cycles_x=8, cycles_y=0, amp=0.4):
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    return (0.5 + amp * np.sin(2 * np.pi * (cycles_x * x + cycles_y * y) / n)).astype(np.float32)


# ---------- fft ----------

def test_impulse_has_flat_magnitude():
    img = np.zeros((64, 64), dtype=np.float32)
    img[10, 20] = 1.0
    F = ffx.compute_fft(img)
    mag = np.abs(F)
    assert np.allclose(mag, mag[0, 0], rtol=1e-4)


def test_sinusoid_peaks_at_expected_frequency():
    n, cx = 128, 8
    F = ffx.compute_fft(make_sinusoid(n, cycles_x=cx))
    mag = np.abs(np.fft.fftshift(F)).copy()
    c = n // 2
    mag[c, c] = 0  # remove DC
    ys, xs = np.unravel_index(np.argsort(mag.ravel())[-2:], mag.shape)
    # conjugate pair at (c, c +/- cycles_x)
    assert sorted(xs) == [c - cx, c + cx]
    assert list(ys) == [c, c]


def test_parseval_energy_conservation():
    img = np.random.default_rng(0).random((96, 96)).astype(np.float32)
    F = ffx.compute_fft(img)
    spatial_energy = float(np.sum(img.astype(np.float64) ** 2))
    freq_energy = float(np.sum(np.abs(F.astype(np.complex128)) ** 2) / F.size)
    assert spatial_energy == pytest.approx(freq_energy, rel=1e-4)


# ---------- windows ----------

def test_window_shapes_and_none():
    assert get_window_2d("none", 32, 48) is None
    for name in ("hann", "hamming", "blackman", "tukey"):
        w = get_window_2d(name, 32, 48)
        assert w.shape == (32, 48)
        assert w.max() <= 1.0
    img = np.ones((32, 48), dtype=np.float32)
    assert apply_window(img, "hann")[0, 0] == pytest.approx(0.0, abs=1e-6)


# ---------- io ----------

def _png_bytes(arr, mode="L"):
    buf = io.BytesIO()
    Image.fromarray(arr, mode=mode).save(buf, "PNG")
    return buf.getvalue()


def test_load_8bit_png():
    arr = (np.random.default_rng(4).random((20, 30)) * 255).astype(np.uint8)
    img = load_image_bytes(_png_bytes(arr), "test.png")
    assert img.pixels.shape == (20, 30)
    assert img.meta["bit_depth"] == 8
    assert img.meta["aspect_ratio"] == 1.5
    assert np.allclose(img.pixels, arr / 255.0)


def test_load_16bit_tiff():
    import tifffile

    arr = (np.random.default_rng(5).random((16, 16)) * 65535).astype(np.uint16)
    buf = io.BytesIO()
    tifffile.imwrite(buf, arr)
    img = load_image_bytes(buf.getvalue(), "test.tif")
    assert img.meta["bit_depth"] == 16
    assert np.allclose(img.pixels, arr / 65535.0, atol=1e-6)


def test_rgb_alpha_and_channels():
    arr = (np.random.default_rng(6).random((10, 10, 4)) * 255).astype(np.uint8)
    img = load_image_bytes(_png_bytes(arr, mode="RGBA"), "t.png")
    assert img.pixels.shape == (10, 10, 3)
    luma = to_channel(img.pixels, "luma")
    assert luma.shape == (10, 10)
    assert np.allclose(to_channel(img.pixels, "r"), img.pixels[:, :, 0])


# ---------- metrics ----------

def test_pink_noise_slope_near_2():
    n = 256
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    r = np.hypot(fy, fx)
    r[0, 0] = 1.0
    amp = 1.0 / r
    amp[0, 0] = 0.0
    rng = np.random.default_rng(7)
    field = np.fft.ifft2(amp * np.exp(1j * rng.uniform(0, 2 * np.pi, (n, n)))).real
    field = ((field - field.min()) / (field.max() - field.min())).astype(np.float32)
    m = compute_metrics(field)
    assert 1.5 < m["spectral_slope"] < 2.6
    assert m["slope_r2"] > 0.9


def test_white_noise_flat_slope_high_entropy():
    img = np.random.default_rng(8).random((256, 256)).astype(np.float32)
    m = compute_metrics(img)
    assert abs(m["spectral_slope"]) < 0.5
    assert m["spectral_entropy"] > 0.9
    assert m["hf_energy_ratio"] > 0.4


def test_grating_dominant_orientation():
    n = 256
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    theta = np.radians(45)
    img = (0.5 + 0.4 * np.sin(2 * np.pi * 16 / n * (x * np.cos(theta) + y * np.sin(theta)))).astype(np.float32)
    m = compute_metrics(img)
    assert abs(m["dominant_orientation_deg"] - 45.0) < 10.0
    assert m["orientation_anisotropy"] > 1.0


def test_radial_profile_monotone_for_pink_noise():
    freqs, prof = radial_profile(np.outer(np.ones(64), np.ones(64)), nbins=16)
    assert len(freqs) == 16 and len(prof) == 16
    alpha, r2 = spectral_slope(freqs, prof)
    assert alpha == pytest.approx(0.0, abs=0.05)  # flat PSD -> slope 0


def test_signed_16bit_tiff_reports_16_bits():
    import tifffile

    arr = np.random.default_rng(9).integers(-1000, 1000, (16, 16)).astype(np.int16)
    buf = io.BytesIO()
    tifffile.imwrite(buf, arr)
    img = load_image_bytes(buf.getvalue(), "signed.tif")
    assert img.meta["bit_depth"] == 16
    assert img.pixels.min() == 0.0 and img.pixels.max() == 1.0
