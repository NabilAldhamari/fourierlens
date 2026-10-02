"""Pre-filtering pipeline: each op must return a valid [0,1] image and have the
intended spectral effect."""

import numpy as np
import pytest

from fourierlens.core.metrics import compute_metrics
from fourierlens.core.preprocess import PREPROCESS_OPS, apply_preprocess, describe_ops


def _pink(n=128, alpha=2.0, seed=0):
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    r = np.hypot(fy, fx)
    r[0, 0] = 1.0
    amp = 1.0 / r ** (alpha / 2.0)
    amp[0, 0] = 0.0
    rng = np.random.default_rng(seed)
    f = np.fft.ifft2(amp * np.exp(1j * rng.uniform(0, 2 * np.pi, (n, n)))).real
    return ((f - f.min()) / (f.max() - f.min())).astype(np.float32)


@pytest.mark.parametrize("op", list(PREPROCESS_OPS))
def test_every_op_returns_valid_image(op):
    img = _pink()
    out = apply_preprocess(img, op, amount=1.0)
    assert out.shape == img.shape
    assert out.dtype == np.float32
    assert out.min() >= 0.0 and out.max() <= 1.0 + 1e-5
    assert np.isfinite(out).all()


def test_none_is_identity():
    img = _pink()
    assert np.array_equal(apply_preprocess(img, "none"), img)


def test_zero_amount_is_identity_for_amount_ops():
    img = _pink()
    for op in ("sharpen", "blur", "median"):
        assert np.array_equal(apply_preprocess(img, op, amount=0.0), img)


def test_edges_raise_high_frequency_content():
    """Edge extraction removes smooth shading, shifting energy to high freqs."""
    img = _pink(alpha=2.5)  # smooth image, little HF energy
    base = compute_metrics(img)["hf_energy_ratio"]
    edged = compute_metrics(apply_preprocess(img, "edges"))["hf_energy_ratio"]
    assert edged > base


def test_blur_reduces_high_frequency_content():
    img = _pink(alpha=1.2)  # rough image, lots of HF energy
    base = compute_metrics(img)["hf_energy_ratio"]
    blurred = compute_metrics(apply_preprocess(img, "blur", amount=2.0))["hf_energy_ratio"]
    assert blurred < base


def test_invert_preserves_spectrum_magnitude_shape():
    img = _pink()
    inv = apply_preprocess(img, "invert")
    assert np.allclose(inv, 1.0 - img)


def test_describe_ops_shape():
    ops = describe_ops()
    assert "edges" in ops
    assert set(ops["edges"]) == {"label", "uses_amount", "description"}
    assert ops["sharpen"]["uses_amount"] is True
    assert ops["edges"]["uses_amount"] is False
