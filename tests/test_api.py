"""API surface tests via FastAPI TestClient (no network)."""

import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fourierlens.server.app import app

client = TestClient(app)


def _upload(name="test.png", fmt="PNG") -> str:
    rng = np.random.default_rng(0)
    arr = np.clip(128 + rng.normal(0, 20, (96, 128, 3)), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, fmt)
    buf.seek(0)
    r = client.post("/api/images", files={"file": (name, buf, "image/png")})
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def image_id() -> str:
    return _upload()


def test_health_and_config():
    assert client.get("/api/health").json()["ok"] is True
    cfg = client.get("/api/config").json()
    assert [t["id"] for t in cfg["tabs"]] == ["color", "noise", "compression", "blending", "frequency"]
    ela = next(v for v in cfg["views"] if v["id"] == "ela")
    assert ela["param"]["default"] == 90 and ela["look_for"]


def test_meta(image_id):
    meta = client.get(f"/api/images/{image_id}").json()
    assert meta["width"] == 128 and meta["analysis_width"] == 128


def test_original_and_every_view(image_id):
    r = client.get(f"/api/images/{image_id}/original.png")
    assert r.status_code == 200 and Image.open(io.BytesIO(r.content)).size == (128, 96)
    for v in client.get("/api/config").json()["views"]:
        r = client.get(f"/api/images/{image_id}/views/{v['id']}.png")
        assert r.status_code == 200, v["id"]
        assert Image.open(io.BytesIO(r.content)).size == (128, 96)


def test_view_param_validation(image_id):
    assert client.get(f"/api/images/{image_id}/views/ela.png?quality=70").status_code == 200
    assert client.get(f"/api/images/{image_id}/views/ela.png?quality=20").status_code == 422
    assert client.get(f"/api/images/{image_id}/views/nope.png").status_code == 404


def test_findings(image_id):
    f = client.get(f"/api/images/{image_id}/findings").json()
    assert isinstance(f["flags"], list)
    assert len(f["spectrum"]["freqs"]) == len(f["spectrum"]["log_power"])
    for flag in f["flags"]:
        assert {"type", "severity", "title", "explanation", "view"} <= flag.keys()


def test_unknown_image_404():
    assert client.get("/api/images/doesnotexist/original.png").status_code == 404


def test_bad_upload_422():
    r = client.post("/api/images", files={"file": ("x.png", b"not an image", "image/png")})
    assert r.status_code == 422


def test_samples():
    names = [s["name"] for s in client.get("/api/samples").json()]
    if not names:  # samples exist in a repo checkout
        pytest.skip("no samples")
    assert client.get(f"/api/samples/{names[0]}/thumb.png").status_code == 200
    r = client.post("/api/images/sample", json={"name": names[0]})
    assert r.status_code == 200 and r.json()["id"]


def test_blended_sample_is_flagged():
    if "blended" not in [s["name"] for s in client.get("/api/samples").json()]:
        pytest.skip("no samples")
    image_id = client.post("/api/images/sample", json={"name": "blended"}).json()["id"]
    flags = client.get(f"/api/images/{image_id}/findings").json()["flags"]
    assert flags[0]["type"] == "missing_noise" and flags[0]["view"] == "noise_level"
