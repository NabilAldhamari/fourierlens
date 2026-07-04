"""API surface tests via FastAPI TestClient (no network)."""

import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fourierlens.server.app import app

client = TestClient(app)


def _upload(arr01: np.ndarray, name="test.png") -> str:
    buf = io.BytesIO()
    Image.fromarray((arr01 * 255).astype(np.uint8)).save(buf, "PNG")
    buf.seek(0)
    r = client.post("/api/images", files={"file": (name, buf, "image/png")})
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def grating_id() -> str:
    n = 128
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    return _upload(0.5 + 0.4 * np.sin(2 * np.pi * 8 * x / n))


def test_health_and_config():
    assert client.get("/api/health").json()["ok"] is True
    cfg = client.get("/api/config").json()
    assert "hann" in cfg["windows"]
    assert "spectral_slope" in cfg["metrics"]


def test_upload_meta_and_pixels(grating_id):
    meta = client.get(f"/api/images/{grating_id}").json()
    assert meta["width"] == 128 and meta["bit_depth"] == 8
    r = client.get(f"/api/images/{grating_id}/pixels.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"


def test_spectrum_views(grating_id):
    for kind in ("magnitude", "phase", "psd"):
        r = client.get(f"/api/images/{grating_id}/spectrum.png", params={"kind": kind, "window": "hann"})
        assert r.status_code == 200, kind
    assert client.get(f"/api/images/{grating_id}/spectrum.png", params={"kind": "nope"}).status_code == 422


def test_band_energy_and_filter(grating_id):
    body = {"specs": [{"type": "annulus", "r_inner": 0.05, "r_outer": 0.3}], "channel": "luma"}
    r = client.post(f"/api/images/{grating_id}/band-energy.png", json=body)
    assert r.status_code == 200
    r = client.post(f"/api/images/{grating_id}/filter.png", json={**body, "invert": True})
    assert r.status_code == 200
    r = client.post(f"/api/images/{grating_id}/mask.png", json=body)
    assert r.status_code == 200


def test_patch_spectrum_and_reconstruct(grating_id):
    r = client.post(
        f"/api/images/{grating_id}/patch-spectrum.png",
        json={"x": 10, "y": 10, "w": 48, "h": 48},
    )
    assert r.status_code == 200
    r = client.get(f"/api/images/{grating_id}/reconstruct.png", params={"fraction": 0.2})
    assert r.status_code == 200


def test_metrics_and_anomalies(grating_id):
    m = client.get(f"/api/images/{grating_id}/metrics").json()
    assert "spectral_slope" in m and len(m["radial_profile"]["freqs"]) == 64
    flags = client.get(f"/api/images/{grating_id}/anomalies").json()
    assert isinstance(flags, list)


def test_unknown_image_404():
    assert client.get("/api/images/doesnotexist").status_code == 404


def test_samples_listing():
    r = client.get("/api/samples")
    assert r.status_code == 200
    names = [s["name"] for s in r.json()]
    if names:  # samples exist in a repo checkout
        assert "grating" in names
        rr = client.post("/api/images/sample", json={"path": "grating"})
        assert rr.status_code == 200


def test_batch_job_roundtrip(tmp_path):
    rng = np.random.default_rng(0)
    for i in range(3):
        Image.fromarray((rng.random((48, 48)) * 255).astype(np.uint8)).save(tmp_path / f"i{i}.png")
    r = client.post("/api/batch", json={"directory": str(tmp_path), "workers": 1})
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]

    import time

    for _ in range(100):
        s = client.get(f"/api/jobs/{job_id}").json()
        if s["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert s["status"] == "done", s
    rows = client.get(f"/api/jobs/{job_id}/rows").json()
    assert len(rows) == 3 and "spectral_slope" in rows[0]
    assert client.get(f"/api/jobs/{job_id}/mean-spectrum.png").status_code == 200
    for fmt in ("csv", "json", "parquet"):
        assert client.get(f"/api/jobs/{job_id}/export", params={"format": fmt}).status_code == 200
