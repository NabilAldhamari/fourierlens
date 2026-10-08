"""FastAPI application: HTTP surface for the web UI.

Compute happens in the core modules; this file is routing, validation and PNG
encoding only. Every view travels as a ready-to-show PNG at the analysis
resolution, so the browser only has to draw it.
"""

from __future__ import annotations

import os
import re
import threading
import webbrowser
from io import BytesIO
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

from .. import __version__
from ..core.anomalies import detect_all
from ..core.forensics import (
    BLOCK_FEATURE_VIEWS,
    VIEW_BY_ID,
    catalog,
    forensic_checks,
    luma,
    render_view,
    spectrum_profile,
)
from ..core.io import SUPPORTED_EXTENSIONS, load_image, load_image_bytes
from .store import ImageStore


def _find_samples_dir() -> Path:
    """Samples ship inside the package for installed wheels, but live at the repo
    root in a dev checkout. Prefer whichever actually contains images."""
    packaged = Path(__file__).resolve().parent.parent / "samples"  # src/fourierlens/samples
    repo_root = Path(__file__).resolve().parents[3] / "samples"
    for candidate in (packaged, repo_root):
        if candidate.is_dir() and any(candidate.iterdir()):
            return candidate
    return packaged  # default; list_samples handles a missing dir gracefully


SAMPLES_DIR = _find_samples_dir()
WEBUI_DIR = Path(__file__).resolve().parent.parent / "webui"

# Upload limits: these only stop a runaway upload from exhausting RAM.
MAX_UPLOAD_BYTES = 256 * 1024 * 1024
MAX_UPLOAD_PIXELS = 256_000_000
_SAMPLE_NAME = re.compile(r"[A-Za-z0-9_\-]+")

# Only answer requests addressed to the local machine. Without this, a web page
# the user visits could rebind its DNS name to 127.0.0.1 and drive this API from
# the browser. Add names via FOURIERLENS_ALLOWED_HOSTS (comma-separated) when
# serving behind a proxy.
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"] + [
    h.strip() for h in os.environ.get("FOURIERLENS_ALLOWED_HOSTS", "").split(",") if h.strip()
]

store = ImageStore()

app = FastAPI(title="FourierLens", version=__version__)


@app.exception_handler(ValueError)
async def _value_error_as_422(_request, exc: ValueError):
    """Core modules raise ValueError for bad user input; surface it as 422."""
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.middleware("http")
async def _reject_foreign_hosts(request, call_next):
    host = request.headers.get("host", "")
    name = host.rsplit(":", 1)[0] if not host.endswith("]") else host  # keep [::1] intact
    if name not in ALLOWED_HOSTS:
        return Response(f"Host {name!r} is not allowed", status_code=400, media_type="text/plain")
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],  # vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# helpers

def _png_bytes(arr: np.ndarray) -> bytes:
    buf = BytesIO()
    # compress_level=2: ~4x faster than the default on megapixel views
    Image.fromarray(arr, mode="L" if arr.ndim == 2 else "RGB").save(buf, "PNG", compress_level=2)
    return buf.getvalue()


def _png(data: bytes) -> Response:
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


def _record(image_id: str):
    record = store.get(image_id)
    if record is None:
        raise HTTPException(404, f"Unknown image id {image_id!r} (server restarted? open the image again)")
    return record


def _added(image_id: str, record) -> dict:
    return {"id": image_id, "meta": record.meta}


class SampleRequest(BaseModel):
    name: str


# --------------------------------------------------------------------------
# meta

@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": __version__}


@app.get("/api/config")
def config() -> dict:
    return {**catalog(), "version": __version__, "extensions": sorted(SUPPORTED_EXTENSIONS)}


# --------------------------------------------------------------------------
# image lifecycle

def _sample_path(name: str) -> Path:
    if _SAMPLE_NAME.fullmatch(name):
        for p in sorted(SAMPLES_DIR.glob(f"{name}.*")):
            if p.suffix.lower() in SUPPORTED_EXTENSIONS:
                return p
    raise HTTPException(404, f"No sample named {name!r}")


@app.get("/api/samples")
def list_samples() -> list[dict]:
    if not SAMPLES_DIR.is_dir():
        return []
    return [
        {"name": p.stem, "filename": p.name}
        for p in sorted(SAMPLES_DIR.iterdir())
        if p.suffix.lower() in SUPPORTED_EXTENSIONS
    ]


@app.get("/api/samples/{name}/thumb.png")
def sample_thumb(name: str):
    with Image.open(_sample_path(name)) as im:
        im = im.convert("RGB")
        im.thumbnail((320, 320))
        buf = BytesIO()
        im.save(buf, "PNG")
    return _png(buf.getvalue())


@app.post("/api/images/sample")
def load_sample(req: SampleRequest) -> dict:
    return _added(*store.add(load_image(_sample_path(req.name))))


@app.post("/api/images")
async def upload_image(file: UploadFile = File(...)) -> dict:
    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        data += chunk
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit")
    try:
        image = load_image_bytes(bytes(data), file.filename or "upload", max_pixels=MAX_UPLOAD_PIXELS)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Could not open this file as an image: {exc}") from exc
    return _added(*store.add(image))


@app.get("/api/images/{image_id}")
def image_meta(image_id: str) -> dict:
    return _record(image_id).meta


# --------------------------------------------------------------------------
# views

@app.get("/api/images/{image_id}/original.png")
def original_png(image_id: str):
    record = _record(image_id)
    return _png(record.render(("original",), lambda: _png_bytes(record.rgb8)))


@app.get("/api/images/{image_id}/views/{view}.png")
def view_png(image_id: str, view: str, quality: int | None = None):
    record = _record(image_id)
    info = VIEW_BY_ID.get(view)
    if info is None:
        raise HTTPException(404, f"Unknown view {view!r}")
    if info.param:
        q = info.param["default"] if quality is None else quality
        if not info.param["min"] <= q <= info.param["max"]:
            raise HTTPException(422, f"quality must be between {info.param['min']} and {info.param['max']}")
    else:
        q = None
    feats = record.features() if view in BLOCK_FEATURE_VIEWS else None
    data = record.render((view, q), lambda: _png_bytes(render_view(view, record.rgb8, quality=q, feats=feats)))
    return _png(data)


# --------------------------------------------------------------------------
# automatic checks

# spectral detectors (anomalies.py) read best in the Fourier view, except the JPEG grid
_SPECTRAL_VIEW_OVERRIDES = {"jpeg_grid": "residual_spectrum"}


def _metadata_flags(meta: dict) -> list[dict]:
    flags = []
    if meta.get("generator_metadata"):
        keys = ", ".join(meta["generator_metadata"])
        flags.append({
            "type": "generator_metadata", "view": None, "severity": 0.95,
            "title": "File carries AI image generator settings",
            "explanation": (
                f"The file contains the metadata field(s) {keys}, which image generators such as "
                "Stable Diffusion front-ends write to store the prompt and settings."
            ),
        })
    if meta.get("software"):
        flags.append({
            "type": "software", "view": None, "severity": 0.3,
            "title": f"Last saved by {meta['software']}",
            "explanation": (
                "The EXIF Software tag names the program that wrote the file. Editors and phone apps "
                "set it routinely, so it shows processing, not manipulation."
            ),
        })
    return flags


def _findings(record) -> dict:
    rgb8 = record.rgb8
    flags = [
        *_metadata_flags(record.meta),
        *forensic_checks(rgb8, record.features()),
        *_spectral_flags(luma(rgb8) / 255.0, is_jpeg=record.meta.get("format") == "JPEG"),
    ]
    flags.sort(key=lambda f: f["severity"], reverse=True)
    return {"flags": _clean_nans(flags), "spectrum": _clean_nans(spectrum_profile(rgb8))}


def _spectral_flags(gray: np.ndarray, is_jpeg: bool) -> list[dict]:
    flags = []
    for f in detect_all(gray):
        if f["type"] == "jpeg_grid":
            if is_jpeg:
                continue  # expected in every JPEG: not a lead
            f["title"] = "Periodic 8-pixel grid"
            f["explanation"] = (
                "There is extra energy at multiples of 1/8 cycles per pixel. This file is not a JPEG, "
                "so either it was JPEG-compressed earlier and re-saved, or it was produced by 2×, 4× "
                "or 8× upsampling, as in many image generators."
            )
        f.pop("locations", None)
        f["view"] = _SPECTRAL_VIEW_OVERRIDES.get(f["type"], "fourier")
        flags.append(f)
    return flags


@app.get("/api/images/{image_id}/findings")
def findings(image_id: str) -> dict:
    record = _record(image_id)
    return record.cached("findings", lambda: _findings(record))


def _clean_nans(obj):
    """JSON forbids NaN/Inf; replace them with null recursively."""
    if isinstance(obj, (float, np.floating)):
        return float(obj) if np.isfinite(obj) else None
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, dict):
        return {k: _clean_nans(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean_nans(v) for v in obj]
    return obj


# --------------------------------------------------------------------------
# static web UI (must be mounted last so /api keeps priority)

if WEBUI_DIR.is_dir() and (WEBUI_DIR / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(WEBUI_DIR), html=True), name="webui")
else:  # pragma: no cover - only hit in broken source checkouts

    @app.get("/")
    def missing_ui() -> Response:
        return Response(
            "<h1>FourierLens API is running</h1><p>Web UI bundle not found. "
            "Build it with: <code>cd frontend && npm install && npm run build</code></p>",
            media_type="text/html",
        )


def run_server(host: str = "127.0.0.1", port: int = 8321, open_browser: bool = True, dev: bool = False) -> None:
    import uvicorn

    if host not in ("0.0.0.0", "::") and host not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(host)
    if open_browser:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://{host}:{port}")).start()
    print(f"FourierLens {__version__} - http://{host}:{port}  (Ctrl+C to stop)")
    if dev:
        # auto-reload needs the app as an import string; watch only our package
        uvicorn.run(
            "fourierlens.server.app:app",
            host=host,
            port=port,
            log_level="info",
            reload=True,
            reload_dirs=[str(Path(__file__).resolve().parents[1])],
        )
    else:
        uvicorn.run(app, host=host, port=port, log_level="warning")
