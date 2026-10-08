"""Host allowlist, upload limits, sample-name sanitizing."""

import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fourierlens.core.io import load_image_bytes
from fourierlens.server import app as appmod

client = TestClient(appmod.app)


def _png_bytes(w=16, h=16) -> bytes:
    buf = io.BytesIO()
    noise = np.random.default_rng(0).integers(0, 256, (h, w), dtype=np.uint8)
    Image.fromarray(noise).save(buf, "PNG")
    return buf.getvalue()


def test_foreign_host_rejected():
    assert client.get("/api/health", headers={"host": "evil.example.com"}).status_code == 400
    assert client.get("/api/health", headers={"host": "localhost:8321"}).status_code == 200
    assert client.get("/api/health", headers={"host": "127.0.0.1:8321"}).status_code == 200
    assert client.get("/api/health", headers={"host": "[::1]:8321"}).status_code == 200


def test_upload_too_large(monkeypatch):
    monkeypatch.setattr(appmod, "MAX_UPLOAD_BYTES", 100)
    r = client.post("/api/images", files={"file": ("a.png", _png_bytes(64, 64), "image/png")})
    assert r.status_code == 413


def test_upload_too_many_pixels(monkeypatch):
    monkeypatch.setattr(appmod, "MAX_UPLOAD_PIXELS", 100)
    r = client.post("/api/images", files={"file": ("a.png", _png_bytes(32, 32), "image/png")})
    assert r.status_code == 422 and "limit" in r.json()["detail"]


def test_max_pixels_tiff():
    import tifffile

    buf = io.BytesIO()
    tifffile.imwrite(buf, np.zeros((32, 32), np.uint16))
    with pytest.raises(ValueError, match="limit"):
        load_image_bytes(buf.getvalue(), "a.tif", max_pixels=100)
    assert load_image_bytes(buf.getvalue(), "a.tif", max_pixels=10_000).meta["width"] == 32


@pytest.mark.parametrize("name", ["../x", "*", "a/b", "..\\x", ""])
def test_sample_name_sanitized(name):
    assert client.post("/api/images/sample", json={"name": name}).status_code == 404
