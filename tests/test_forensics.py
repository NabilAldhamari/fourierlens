"""Forensic views and checks on synthetic manipulations with known ground truth."""

import io

import numpy as np
import pytest
from PIL import Image
from scipy.ndimage import gaussian_filter

from fourierlens.core.forensics import (
    VIEWS,
    block_features,
    catalog,
    forensic_checks,
    render_view,
    spectrum_profile,
)
from fourierlens.core.io import jpeg_quality, load_image_bytes

RNG = np.random.default_rng(3)
H, W = 256, 320


def _jpeg(rgb8: np.ndarray, q: int) -> np.ndarray:
    buf = io.BytesIO()
    Image.fromarray(rgb8).save(buf, "JPEG", quality=q)
    buf.seek(0)
    return np.asarray(Image.open(buf).convert("RGB"))


def _photo() -> np.ndarray:
    """Smooth scene + even sensor noise, like a camera image."""
    y, x = np.mgrid[0:H, 0:W]
    base = 120 + 60 * np.sin(x / 40.0) * np.cos(y / 55.0)
    img = np.stack([base, base * 0.9, base * 0.8], -1) + RNG.normal(0, 5, (H, W, 3))
    return np.clip(img, 0, 255).astype(np.uint8)


def _spliced() -> tuple[np.ndarray, tuple[slice, slice]]:
    """Photo with a noise-free, blended square patch."""
    img = _photo().astype(np.float64)
    region = (slice(80, 176), slice(110, 230))
    clean = gaussian_filter(img, (2, 2, 0))
    alpha = np.zeros((H, W))
    alpha[region] = 1.0
    alpha = gaussian_filter(alpha, 3)[..., None]
    out = img * (1 - alpha) + clean * alpha
    return np.clip(out, 0, 255).astype(np.uint8), region


@pytest.mark.parametrize("view", [v.id for v in VIEWS])
def test_every_view_renders_full_size(view):
    out = render_view(view, _photo(), quality=80)
    assert out.dtype == np.uint8 and out.shape[:2] == (H, W)


def test_unknown_view_rejected():
    with pytest.raises(ValueError):
        render_view("nope", _photo())


def test_catalog_is_consistent():
    cat = catalog()
    tabs = {t["id"] for t in cat["tabs"]}
    assert all(v["tab"] in tabs for v in cat["views"])
    assert len({v["id"] for v in cat["views"]}) == len(cat["views"])


def test_noise_level_map_shows_clean_patch_as_blue():
    img, region = _spliced()
    out = render_view("noise_level", img).astype(int)
    inside = out[region].reshape(-1, 3).mean(0)
    outside = out[:60, :60].reshape(-1, 3).mean(0)
    assert inside[2] - inside[0] > 40  # blue-dominant: cleaner than the norm
    assert inside[2] > outside[2]


def test_missing_noise_check_finds_the_patch():
    img, region = _spliced()
    flags = forensic_checks(img)
    assert [f["type"] for f in flags] == ["missing_noise"]
    r = flags[0]["region"]
    cy, cx = r["y"] + r["h"] / 2, r["x"] + r["w"] / 2
    assert region[0].start < cy < region[0].stop and region[1].start < cx < region[1].stop


def test_missing_noise_check_quiet_on_untouched_photo():
    assert forensic_checks(_jpeg(_photo(), 90)) == []


def test_boundary_map_peaks_at_the_seam():
    img, region = _spliced()
    b = render_view("boundary", img).astype(float).sum(-1)
    seam = b[region[0].start - 4 : region[0].start + 4, region[1]].mean()
    centre = b[110:140, 150:190].mean()
    assert seam > 2 * centre


def test_jpeg_ghost_lights_up_region_saved_at_that_quality():
    photo = _photo()
    ghosted = _jpeg(photo, 95).copy()
    ghosted[64:192, 96:224] = _jpeg(photo, 60)[64:192, 96:224]
    g = render_view("ghost", ghosted, quality=60).astype(float).sum(-1)
    assert g[96:160, 128:192].mean() > g[:40, :60].mean() + 60


def test_ela_higher_on_never_compressed_region():
    photo = _photo()
    mixed = _jpeg(photo, 90).copy()
    mixed[64:192, 96:224] = photo[64:192, 96:224]  # pasted from an uncompressed source
    e = render_view("ela", mixed, quality=90).astype(float).sum(-1)
    assert e[96:160, 128:192].mean() > 1.5 * e[:40, :60].mean()


def test_spectrum_profile_has_fit():
    prof = spectrum_profile(_photo())
    assert len(prof["freqs"]) == len(prof["log_power"]) and prof["fit"] is not None


def test_block_features_shapes():
    feats = block_features(_photo())
    assert {k: v.shape for k, v in feats.items()} == {k: (H // 8, W // 8) for k in ("noise", "sharpness", "ela")}


def test_jpeg_quality_estimate():
    for q in (60, 75, 90):
        buf = io.BytesIO()
        Image.fromarray(_photo()).save(buf, "JPEG", quality=q)
        assert abs(load_image_bytes(buf.getvalue(), "a.jpg").meta["jpeg_quality"] - q) <= 1
    assert jpeg_quality(None) is None


def test_generator_metadata_detected():
    from PIL import PngImagePlugin

    info = PngImagePlugin.PngInfo()
    info.add_text("parameters", "a cat, Steps: 20")
    buf = io.BytesIO()
    Image.fromarray(_photo()).save(buf, "PNG", pnginfo=info)
    assert load_image_bytes(buf.getvalue(), "a.png").meta["generator_metadata"] == ["parameters"]
