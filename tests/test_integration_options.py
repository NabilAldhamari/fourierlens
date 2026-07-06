"""Integration tests: every user-facing option, exercised individually through
the real API surface (FastAPI TestClient, no mocks).

One parametrized case per option value, so a regression in any single window /
scale / channel / pre-filter / mask shape / export format fails as its own
named test instead of hiding inside a broader flow.
"""

import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fourierlens.core.preprocess import PREPROCESS_OPS
from fourierlens.core.windows import WINDOW_NAMES
from fourierlens.server.app import app
from fourierlens.server.store import MAX_ANALYSIS_DIM

client = TestClient(app)

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _upload_array(arr8: np.ndarray, name: str = "test.png") -> str:
    buf = io.BytesIO()
    Image.fromarray(arr8).save(buf, "PNG")
    buf.seek(0)
    r = client.post("/api/images", files={"file": (name, buf, "image/png")})
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def gray_id() -> str:
    """Grayscale grating + noise: has structure in every view."""
    n = 128
    rng = np.random.default_rng(0)
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    img = 0.5 + 0.3 * np.sin(2 * np.pi * 10 * x / n) + 0.1 * rng.standard_normal((n, n))
    return _upload_array((np.clip(img, 0, 1) * 255).astype(np.uint8))


@pytest.fixture(scope="module")
def rgb_id() -> str:
    rng = np.random.default_rng(1)
    return _upload_array((rng.random((96, 96, 3)) * 255).astype(np.uint8), "rgb.png")


def _assert_png(resp) -> bytes:
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "image/png"
    assert resp.content.startswith(PNG_MAGIC)
    return resp.content


# ---------------------------------------------------------------- pre-filters

@pytest.mark.parametrize("op", list(PREPROCESS_OPS))
def test_spectrum_with_each_preprocess_op(gray_id, op):
    r = client.get(
        f"/api/images/{gray_id}/spectrum.png",
        params={"window": "hann", "preprocess": op, "pre_amount": 1.0},
    )
    _assert_png(r)


@pytest.mark.parametrize("op", list(PREPROCESS_OPS))
def test_pixels_view_with_each_preprocess_op(gray_id, op):
    r = client.get(f"/api/images/{gray_id}/pixels.png", params={"preprocess": op})
    _assert_png(r)


@pytest.mark.parametrize("op", list(PREPROCESS_OPS))
def test_metrics_with_each_preprocess_op(gray_id, op):
    r = client.get(f"/api/images/{gray_id}/metrics", params={"preprocess": op})
    assert r.status_code == 200
    assert "spectral_slope" in r.json()


def test_unknown_preprocess_rejected(gray_id):
    r = client.get(f"/api/images/{gray_id}/spectrum.png", params={"preprocess": "nope"})
    assert r.status_code == 422
    assert "Unknown preprocess" in r.json()["detail"]


# ------------------------------------------------------------------- windows

@pytest.mark.parametrize("window", WINDOW_NAMES)
def test_spectrum_with_each_window(gray_id, window):
    _assert_png(client.get(f"/api/images/{gray_id}/spectrum.png", params={"window": window}))


# -------------------------------------------------------------------- scales

@pytest.mark.parametrize("scale", ["log", "linear", "gamma"])
def test_spectrum_with_each_scale(gray_id, scale):
    _assert_png(
        client.get(f"/api/images/{gray_id}/spectrum.png", params={"scale": scale, "gamma": 0.4}),
    )


# --------------------------------------------------------------------- kinds

@pytest.mark.parametrize("kind", ["magnitude", "phase", "psd"])
def test_each_spectrum_kind(gray_id, kind):
    _assert_png(client.get(f"/api/images/{gray_id}/spectrum.png", params={"kind": kind}))


# ------------------------------------------------------------------- channels

@pytest.mark.parametrize("channel", ["luma", "r", "g", "b"])
def test_spectrum_each_channel_rgb_image(rgb_id, channel):
    _assert_png(client.get(f"/api/images/{rgb_id}/spectrum.png", params={"channel": channel}))


@pytest.mark.parametrize("channel", ["rgb", "luma", "r", "g", "b"])
def test_pixels_each_channel(rgb_id, channel):
    _assert_png(client.get(f"/api/images/{rgb_id}/pixels.png", params={"channel": channel}))


# ---------------------------------------------------------------- mask shapes

MASK_SPECS = {
    "rect": {"type": "rect", "x": 0.55, "y": 0.25, "w": 0.2, "h": 0.15},
    "ellipse": {"type": "ellipse", "cx": 0.65, "cy": 0.35, "rx": 0.1, "ry": 0.08},
    "annulus": {"type": "annulus", "r_inner": 0.1, "r_outer": 0.4},
    "wedge": {"type": "wedge", "angle_deg": 30, "width_deg": 20},
    "point": {"type": "point", "x": 0.62, "y": 0.5, "r": 0.05},
    "brush": {"type": "brush", "points": [[0.6, 0.3], [0.7, 0.35], [0.75, 0.45]], "r": 0.04},
}


@pytest.mark.parametrize("shape", list(MASK_SPECS))
def test_band_energy_each_mask_shape(gray_id, shape):
    body = {"specs": [MASK_SPECS[shape]], "channel": "luma", "window": "none"}
    _assert_png(client.post(f"/api/images/{gray_id}/band-energy.png", json=body))


@pytest.mark.parametrize("shape", list(MASK_SPECS))
def test_filter_each_mask_shape(gray_id, shape):
    body = {"specs": [MASK_SPECS[shape]], "channel": "luma", "window": "none"}
    _assert_png(client.post(f"/api/images/{gray_id}/filter.png", json=body))


@pytest.mark.parametrize("invert", [False, True])
def test_filter_invert_option(gray_id, invert):
    body = {"specs": [MASK_SPECS["annulus"]], "invert": invert, "channel": "luma"}
    _assert_png(client.post(f"/api/images/{gray_id}/filter.png", json=body))


@pytest.mark.parametrize("soft_px", [0, 2, 10])
def test_filter_soft_edge_option(gray_id, soft_px):
    body = {"specs": [MASK_SPECS["rect"]], "soft_px": soft_px, "channel": "luma"}
    _assert_png(client.post(f"/api/images/{gray_id}/filter.png", json=body))


def test_multiple_specs_union(gray_id):
    body = {"specs": [MASK_SPECS["point"], MASK_SPECS["wedge"]], "channel": "luma"}
    _assert_png(client.post(f"/api/images/{gray_id}/band-energy.png", json=body))


def test_mask_preview_endpoint(gray_id):
    body = {"specs": [MASK_SPECS["ellipse"]], "channel": "luma"}
    _assert_png(client.post(f"/api/images/{gray_id}/mask.png", json=body))


# --------------------------------------------------- progressive reconstruction

@pytest.mark.parametrize("fraction", [0.01, 0.15, 0.5, 1.0])
def test_reconstruct_each_fraction(gray_id, fraction):
    _assert_png(client.get(f"/api/images/{gray_id}/reconstruct.png", params={"fraction": fraction}))


def test_reconstruct_full_fraction_matches_pixels(gray_id):
    """fraction >= 1 keeps every frequency: the rebuild equals the original."""
    full = client.get(f"/api/images/{gray_id}/reconstruct.png", params={"fraction": 1.5, "channel": "luma"})
    orig = client.get(f"/api/images/{gray_id}/pixels.png", params={"channel": "luma"})
    a = np.asarray(Image.open(io.BytesIO(full.content)), dtype=np.int16)
    b = np.asarray(Image.open(io.BytesIO(orig.content)), dtype=np.int16)
    assert np.abs(a - b).max() <= 1  # uint8 rounding only


# --------------------------------------------------------------- patch spectrum

@pytest.mark.parametrize("window", ["hann", "none"])
def test_patch_spectrum_windows(gray_id, window):
    body = {"x": 16, "y": 16, "w": 48, "h": 48, "window": window, "channel": "luma"}
    _assert_png(client.post(f"/api/images/{gray_id}/patch-spectrum.png", json=body))


# ------------------------------------------------------------------ downscaling

def test_large_image_downscaled_for_analysis():
    rng = np.random.default_rng(2)
    big = (rng.random((900, MAX_ANALYSIS_DIM * 2)) * 255).astype(np.uint8)
    image_id = _upload_array(big, "big.png")
    meta = client.get(f"/api/images/{image_id}").json()
    assert meta["width"] == MAX_ANALYSIS_DIM * 2  # original dims preserved in meta
    assert meta["downscaled_for_analysis"] is True
    assert meta["analysis_width"] == MAX_ANALYSIS_DIM
    # served views use the analysis copy
    px = Image.open(io.BytesIO(client.get(f"/api/images/{image_id}/pixels.png").content))
    assert max(px.size) == MAX_ANALYSIS_DIM


def test_small_image_not_downscaled(gray_id):
    meta = client.get(f"/api/images/{gray_id}").json()
    assert meta["downscaled_for_analysis"] is False
    assert meta["analysis_width"] == meta["width"]


# ------------------------------------------------------------------ batch export

@pytest.fixture(scope="module")
def done_job(tmp_path_factory) -> str:
    import time

    folder = tmp_path_factory.mktemp("batchset")
    rng = np.random.default_rng(3)
    for i in range(3):
        Image.fromarray((rng.random((48, 48)) * 255).astype(np.uint8)).save(folder / f"i{i}.png")
    job_id = client.post("/api/batch", json={"directory": str(folder), "workers": 1}).json()["job_id"]
    for _ in range(100):
        if client.get(f"/api/jobs/{job_id}").json()["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "done"
    return job_id


@pytest.mark.parametrize("fmt,expected_type", [
    ("csv", "text/csv"),
    ("json", "application/json"),
    ("parquet", "application/octet-stream"),
])
def test_batch_export_each_format(done_job, fmt, expected_type):
    r = client.get(f"/api/jobs/{done_job}/export", params={"format": fmt})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(expected_type)
    assert len(r.content) > 100


def test_batch_export_unknown_format(done_job):
    assert client.get(f"/api/jobs/{done_job}/export", params={"format": "xml"}).status_code == 422


# ---------------------------------------------------------------- compare page

@pytest.mark.parametrize("channel", ["luma", "r"])
def test_compare_diff_channels(rgb_id, gray_id, channel):
    r = client.post("/api/compare/diff.png", json={"id_a": rgb_id, "id_b": gray_id, "channel": channel})
    _assert_png(r)
