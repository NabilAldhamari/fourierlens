"""FastAPI application: HTTP surface for the web UI.

Compute happens in the core modules; this file is routing, validation, and
PNG encoding only. All display images travel as grayscale/RGB PNGs; the
frontend applies colormaps client-side so cosmetic changes cost no round-trip.
"""

from __future__ import annotations

import threading
import webbrowser
from io import BytesIO
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field

from .. import __version__
from ..core import fft as ffx
from ..core.anomalies import detect_all
from ..core.io import SUPPORTED_EXTENSIONS, load_image, load_image_bytes
from ..core.masks import build_mask, mask_preview
from ..core.metrics import METRIC_INFO, compute_metrics
from ..core.preprocess import describe_ops
from ..core.windows import describe_windows
from .jobs import JobManager
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

store = ImageStore()
jobs = JobManager()

app = FastAPI(title="FourierLens", version=__version__)


@app.exception_handler(ValueError)
async def _value_error_as_422(_request, exc: ValueError):
    """Core modules raise ValueError for bad user input (unknown preprocess op,
    window, mask type...). Surface those as 422 with the message, not a 500."""
    return JSONResponse(status_code=422, content={"detail": str(exc)})


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],  # vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# helpers

def _png(arr: np.ndarray) -> Response:
    mode = "L" if arr.ndim == 2 else "RGB"
    buf = BytesIO()
    # compress_level=2: ~4x faster to encode than the default 6 on megapixel
    # views; a few % larger over localhost is a trade worth making everywhere
    Image.fromarray(arr, mode=mode).save(buf, "PNG", compress_level=2)
    return Response(content=buf.getvalue(), media_type="image/png")


def _record(image_id: str):
    record = store.get(image_id)
    if record is None:
        raise HTTPException(404, f"Unknown image id {image_id!r} (server restarted? reload the image)")
    return record


def _display_rgb(pixels: np.ndarray) -> np.ndarray:
    arr = ffx.to_uint8(pixels)
    return arr if arr.ndim == 3 else np.stack([arr] * 3, axis=-1)


class MaskRequest(BaseModel):
    specs: list[dict] = Field(default_factory=list)
    invert: bool = False
    soft_px: float = 0.0
    channel: str = "luma"
    window: str = "none"
    preprocess: str = "none"
    pre_amount: float = 1.0


class PatchRequest(BaseModel):
    x: int
    y: int
    w: int
    h: int
    window: str = "hann"
    channel: str = "luma"
    preprocess: str = "none"
    pre_amount: float = 1.0


class PathRequest(BaseModel):
    path: str


class BatchRequest(BaseModel):
    directory: str
    recursive: bool = False
    workers: int = 0


# --------------------------------------------------------------------------
# meta

@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": __version__}


@app.get("/api/config")
def config() -> dict:
    return {
        "windows": describe_windows(),
        "metrics": {k: {"label": v[0], "group": v[1]} for k, v in METRIC_INFO.items()},
        "channels": ["luma", "r", "g", "b"],
        "scales": list(ffx.SCALE_MODES),
        "extensions": sorted(SUPPORTED_EXTENSIONS),
        "preprocess": describe_ops(),
    }


# --------------------------------------------------------------------------
# image lifecycle

@app.get("/api/samples")
def list_samples() -> list[dict]:
    if not SAMPLES_DIR.is_dir():
        return []
    return [
        {"name": p.stem, "filename": p.name}
        for p in sorted(SAMPLES_DIR.iterdir())
        if p.suffix.lower() in SUPPORTED_EXTENSIONS
    ]


@app.post("/api/images/sample")
def load_sample(req: PathRequest) -> dict:
    candidates = [p for p in SAMPLES_DIR.glob(f"{req.path}.*") if p.suffix.lower() in SUPPORTED_EXTENSIONS]
    if not candidates:
        raise HTTPException(404, f"No sample named {req.path!r}")
    image_id, record = store.add(load_image(candidates[0]))
    return {"id": image_id, "meta": record.meta}


@app.post("/api/images")
async def upload_image(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    try:
        image = load_image_bytes(data, file.filename or "upload")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Could not decode image: {exc}") from exc
    image_id, record = store.add(image)
    return {"id": image_id, "meta": record.meta}


@app.post("/api/images/from-path")
def image_from_path(req: PathRequest) -> dict:
    path = Path(req.path)
    if not path.is_file():
        raise HTTPException(404, f"File not found: {path}")
    try:
        image = load_image(path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Could not decode image: {exc}") from exc
    image_id, record = store.add(image)
    return {"id": image_id, "meta": record.meta}


@app.get("/api/images/{image_id}")
def image_meta(image_id: str) -> dict:
    return _record(image_id).meta


# --------------------------------------------------------------------------
# views (PNG)

@app.get("/api/images/{image_id}/pixels.png")
def pixels_png(image_id: str, channel: str = "rgb", preprocess: str = "none", pre_amount: float = 1.0):
    """Display image. With a pre-filter active, shows the *analyzed* (filtered)
    channel so the left panel is always what the spectrum is computed from."""
    record = _record(image_id)
    if preprocess != "none":
        chan = "luma" if channel == "rgb" else channel
        return _png(ffx.to_uint8(record.channel(chan, preprocess, pre_amount)))
    if channel == "rgb":
        return _png(_display_rgb(record.pixels))
    return _png(ffx.to_uint8(record.channel(channel)))


@app.get("/api/images/{image_id}/spectrum.png")
def spectrum_png(
    image_id: str,
    kind: str = "magnitude",
    channel: str = "luma",
    window: str = "none",
    scale: str = "log",
    gamma: float = 0.5,
    clip_lo: float = 0.1,
    clip_hi: float = 99.9,
    preprocess: str = "none",
    pre_amount: float = 1.0,
):
    record = _record(image_id)
    F = record.fft(channel, window, preprocess, pre_amount)
    if kind == "magnitude":
        return _png(ffx.magnitude_display(F, scale=scale, gamma=gamma, clip_lo=clip_lo, clip_hi=clip_hi))
    if kind == "psd":
        return _png(ffx.psd_display(F, scale=scale, gamma=gamma, clip_lo=clip_lo, clip_hi=clip_hi))
    if kind == "phase":
        return _png(ffx.phase_display(F))
    raise HTTPException(422, f"Unknown spectrum kind {kind!r}")


@app.post("/api/images/{image_id}/band-energy.png")
def band_energy_png(image_id: str, req: MaskRequest):
    """Spatial energy map of the selected frequency band (the overlay payload)."""
    record = _record(image_id)
    F = record.fft(req.channel, req.window, req.preprocess, req.pre_amount)
    mask = build_mask(F.shape, req.specs, invert=req.invert, symmetric=True, soft_px=req.soft_px)
    return _png(ffx.to_uint8(ffx.band_energy_map(F, mask)))


@app.post("/api/images/{image_id}/filter.png")
def filter_png(image_id: str, req: MaskRequest):
    """Filtered reconstruction. RGB images are filtered per channel to keep color."""
    record = _record(image_id)
    shape = record.pixels.shape[:2]
    mask = build_mask(shape, req.specs, invert=req.invert, symmetric=True, soft_px=req.soft_px)
    if record.pixels.ndim == 3 and req.channel == "luma" and req.preprocess == "none":
        recon = np.stack(
            [ffx.masked_reconstruction(record.fft(c, req.window), mask) for c in ("r", "g", "b")],
            axis=-1,
        )
    else:
        recon = ffx.masked_reconstruction(
            record.fft(req.channel, req.window, req.preprocess, req.pre_amount), mask
        )
    return _png(ffx.to_uint8(recon))


@app.post("/api/images/{image_id}/mask.png")
def mask_png(image_id: str, req: MaskRequest):
    """Shifted preview of the mask itself (for showing the selection on the spectrum)."""
    record = _record(image_id)
    return _png(mask_preview(record.pixels.shape[:2], req.specs, invert=req.invert, soft_px=req.soft_px))


@app.post("/api/images/{image_id}/patch-spectrum.png")
def patch_spectrum_png(image_id: str, req: PatchRequest):
    """Localized spectrum of a spatial ROI (pixel -> frequency direction)."""
    record = _record(image_id)
    img2d = record.channel(req.channel, req.preprocess, req.pre_amount)
    return _png(ffx.patch_spectrum(img2d, req.x, req.y, req.w, req.h, window=req.window, out_size=256))


@app.get("/api/images/{image_id}/reconstruct.png")
def reconstruct_png(
    image_id: str,
    fraction: float = 1.0,
    channel: str = "luma",
    window: str = "none",
    preprocess: str = "none",
    pre_amount: float = 1.0,
):
    """Progressive reconstruction: only radial frequencies below `fraction` of Nyquist."""
    record = _record(image_id)
    if record.pixels.ndim == 3 and channel == "luma" and preprocess == "none":
        recon = np.stack(
            [ffx.lowpass_reconstruction(record.fft(c, window), fraction) for c in ("r", "g", "b")],
            axis=-1,
        )
    else:
        recon = ffx.lowpass_reconstruction(record.fft(channel, window, preprocess, pre_amount), fraction)
    return _png(ffx.to_uint8(recon))


# --------------------------------------------------------------------------
# analysis

@app.get("/api/images/{image_id}/metrics")
def image_metrics(image_id: str, channel: str = "luma", preprocess: str = "none", pre_amount: float = 1.0) -> dict:
    record = _record(image_id)
    key = f"metrics:{channel}:{preprocess}:{round(pre_amount, 3)}"
    return record.analysis_cache(key, lambda: compute_metrics(record.channel(channel, preprocess, pre_amount)))


@app.get("/api/images/{image_id}/anomalies")
def image_anomalies(
    image_id: str, channel: str = "luma", preprocess: str = "none", pre_amount: float = 1.0
) -> list[dict]:
    record = _record(image_id)
    key = f"anomalies:{channel}:{preprocess}:{round(pre_amount, 3)}"
    return record.analysis_cache(key, lambda: detect_all(record.channel(channel, preprocess, pre_amount)))


# --------------------------------------------------------------------------
# compare

class CompareRequest(BaseModel):
    id_a: str
    id_b: str
    channel: str = "luma"
    window: str = "hann"
    size: int = 512


@app.post("/api/compare/diff.png")
def compare_diff_png(req: CompareRequest):
    """Difference of log-magnitude spectra (A minus B), resampled to a common size.

    Encoded as uint8 with 128 = no difference; the client renders it through a
    diverging colormap. Windowed by default since two images rarely share edge
    content, and edge leakage would otherwise dominate the difference.
    """
    rec_a, rec_b = _record(req.id_a), _record(req.id_b)

    def log_spec(record) -> np.ndarray:
        img = Image.fromarray(ffx.to_uint8(record.channel(req.channel)), mode="L")
        img = img.resize((req.size, req.size), Image.BILINEAR)
        arr = np.asarray(img, dtype=np.float32) / 255.0
        F = ffx.compute_fft(arr - float(arr.mean()), req.window)
        return np.log10(np.abs(np.fft.fftshift(F)) + 1e-12)

    diff = log_spec(rec_a) - log_spec(rec_b)
    span = float(np.percentile(np.abs(diff), 99.5)) or 1e-6
    encoded = np.clip(diff / span, -1.0, 1.0) * 127.0 + 128.0
    return _png(encoded.astype(np.uint8))


# --------------------------------------------------------------------------
# batch

@app.get("/api/fs/list")
def fs_list(path: str = "") -> dict:
    """Minimal server-side folder browser so users can pick a dataset directory."""
    base = Path(path) if path else Path.home()
    if not base.is_dir():
        raise HTTPException(404, f"Not a directory: {base}")
    dirs, n_images = [], 0
    try:
        for p in sorted(base.iterdir()):
            if p.is_dir() and not p.name.startswith((".", "$")):
                dirs.append(p.name)
            elif p.suffix.lower() in SUPPORTED_EXTENSIONS:
                n_images += 1
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"path": str(base), "parent": str(base.parent) if base.parent != base else None,
            "dirs": dirs, "image_count": n_images}


@app.post("/api/batch")
def start_batch(req: BatchRequest) -> dict:
    from ..core.io import iter_image_files

    root = Path(req.directory)
    if not root.is_dir():
        raise HTTPException(404, f"Not a directory: {root}")
    paths = list(iter_image_files(root, recursive=req.recursive))
    if not paths:
        raise HTTPException(422, f"No supported images found in {root}")
    job = jobs.start(paths, workers=req.workers)
    return {"job_id": job.id, "total": job.total}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    return job.summary()


@app.get("/api/jobs/{job_id}/rows")
def job_rows(job_id: str) -> list[dict]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    return JSONResponse([_clean_nans(r) for r in job.rows()])


@app.get("/api/jobs/{job_id}/record")
def job_record(job_id: str, path: str) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    rec = job.full_record(path)
    if rec is None:
        raise HTTPException(404, f"No record for {path}")
    return JSONResponse(_clean_nans(rec))


@app.get("/api/jobs/{job_id}/mean-spectrum.png")
def job_mean_spectrum(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    png = job.mean_spectrum_png()
    if png is None:
        raise HTTPException(404, "Mean spectrum not available (job still running?)")
    return Response(content=png, media_type="image/png")


@app.get("/api/jobs/{job_id}/export")
def job_export(job_id: str, format: str = "csv"):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    try:
        payload, media_type, filename = job.export_bytes(format)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return Response(
        content=payload,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _clean_nans(obj):
    """JSON forbids NaN/Inf; replace them with null recursively."""
    if isinstance(obj, float):
        return obj if np.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _clean_nans(v) for k, v in obj.items()}
    if isinstance(obj, list):
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
