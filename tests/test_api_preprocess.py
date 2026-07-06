"""API accepts preprocess params and returns different results than baseline."""

import io

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from fourierlens.server.app import app

client = TestClient(app)


def _upload():
    rng = np.random.default_rng(0)
    arr = (rng.random((96, 96)) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG")
    buf.seek(0)
    return client.post("/api/images", files={"file": ("t.png", buf, "image/png")}).json()["id"]


def test_config_exposes_preprocess():
    cfg = client.get("/api/config").json()
    assert "preprocess" in cfg
    assert "edges" in cfg["preprocess"]
    assert cfg["preprocess"]["edges"]["label"]


def test_spectrum_preprocess_changes_output():
    img_id = _upload()
    base = client.get(f"/api/images/{img_id}/spectrum.png", params={"window": "hann"}).content
    edged = client.get(
        f"/api/images/{img_id}/spectrum.png", params={"window": "hann", "preprocess": "edges"}
    ).content
    assert base != edged


def test_metrics_preprocess_changes_output():
    img_id = _upload()
    base = client.get(f"/api/images/{img_id}/metrics").json()
    blurred = client.get(f"/api/images/{img_id}/metrics", params={"preprocess": "blur", "pre_amount": 2.0}).json()
    assert base["hf_energy_ratio"] != blurred["hf_energy_ratio"]


def test_pixels_reflect_preprocess():
    img_id = _upload()
    plain = client.get(f"/api/images/{img_id}/pixels.png").content
    edged = client.get(f"/api/images/{img_id}/pixels.png", params={"preprocess": "edges"}).content
    assert plain != edged


def test_band_energy_accepts_preprocess():
    img_id = _upload()
    body = {
        "specs": [{"type": "annulus", "r_inner": 0.1, "r_outer": 0.4}],
        "channel": "luma",
        "preprocess": "sharpen",
        "pre_amount": 1.5,
    }
    r = client.post(f"/api/images/{img_id}/band-energy.png", json=body)
    assert r.status_code == 200
