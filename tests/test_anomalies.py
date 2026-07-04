"""Anomaly detectors must fire on synthetic fixtures built to trigger them."""

import io

import numpy as np
from PIL import Image

from fourierlens.core.anomalies import detect_all, detect_spectral_peaks
from fourierlens.core.fft import compute_fft, power_spectrum
from fourierlens.core.io import load_image_bytes


def pink_noise(n=256, alpha=2.0, seed=0):
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    r = np.hypot(fy, fx)
    r[0, 0] = 1.0
    amp = 1.0 / r ** (alpha / 2.0)
    amp[0, 0] = 0.0
    rng = np.random.default_rng(seed)
    field = np.fft.ifft2(amp * np.exp(1j * rng.uniform(0, 2 * np.pi, (n, n)))).real
    return ((field - field.min()) / (field.max() - field.min())).astype(np.float32)


def test_periodic_noise_detected_at_right_location():
    n = 256
    base = pink_noise(n)
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    cycles = 40
    theta = np.radians(20)
    noisy = np.clip(
        base * 0.8 + 0.1 + 0.15 * np.sin(2 * np.pi * cycles / n * (x * np.cos(theta) + y * np.sin(theta))),
        0,
        1,
    ).astype(np.float32)

    flags = detect_all(noisy)
    periodic = [f for f in flags if f["type"] == "periodic_noise"]
    assert periodic, f"no periodic_noise flag; got {[f['type'] for f in flags]}"
    peak = periodic[0]["peaks"][0]
    expected_r = cycles / (n / 2)  # normalized frequency radius
    got_r = float(np.hypot(peak["fx"], peak["fy"]))
    assert abs(got_r - expected_r) < 0.03
    assert abs(peak["orientation_deg"] - 20.0) < 5.0


def test_clean_pink_noise_has_no_high_severity_flags():
    flags = detect_all(pink_noise(seed=3))
    assert all(f["severity"] < 0.6 for f in flags), [
        (f["type"], f["severity"]) for f in flags
    ]


def test_jpeg_compression_detected():
    img8 = (pink_noise(256, alpha=1.8, seed=4) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img8).save(buf, "JPEG", quality=10)
    loaded = load_image_bytes(buf.getvalue(), "x.jpg")
    flags = detect_all(loaded.pixels if loaded.pixels.ndim == 2 else loaded.pixels[:, :, 0])
    assert any(f["type"] == "jpeg_grid" for f in flags), [f["type"] for f in flags]


def test_white_noise_flags_flat_spectrum():
    img = np.random.default_rng(5).random((256, 256)).astype(np.float32)
    flags = detect_all(img)
    types = {f["type"] for f in flags}
    assert "excess_high_frequency" in types or "high_hf_energy" in types


def test_upscaled_image_flags_low_detail():
    small = pink_noise(64, seed=6)
    up = Image.fromarray((small * 255).astype(np.uint8)).resize((256, 256), Image.BICUBIC)
    arr = np.asarray(up, dtype=np.float32) / 255.0
    flags = detect_all(arr)
    assert any(f["type"] == "low_detail" for f in flags), [f["type"] for f in flags]


def test_peak_detector_ignores_dc_region():
    img = pink_noise(seed=7)
    F = compute_fft(img, window="hann")
    peaks = detect_spectral_peaks(power_spectrum(F))
    for p in peaks:
        assert np.hypot(p["fx"], p["fy"]) > 0.04
