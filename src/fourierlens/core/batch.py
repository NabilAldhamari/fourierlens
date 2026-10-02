"""Batch analysis: per-image records + dataset-level statistics.

The worker function is module-level so ProcessPoolExecutor can pickle it on
Windows (spawn). Results are plain dicts ready for pandas/JSON.
"""

from __future__ import annotations

import traceback
from collections.abc import Callable, Iterable
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

from .anomalies import detect_all
from .fft import compute_fft, magnitude_display, power_spectrum
from .io import load_image, to_channel
from .metrics import compute_metrics, scalar_metrics

# Spectrum size used for the dataset mean-spectrum and outlier analysis.
_SPEC_SIZE = 256


def _resize_gray(img2d: np.ndarray, size: int) -> np.ndarray:
    """Cheap area-ish resample to size x size via numpy striding (no cv2 dependency)."""
    from PIL import Image

    im = Image.fromarray((np.clip(img2d, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.resize((size, size), Image.BILINEAR), dtype=np.float32) / 255.0


def analyze_file(path: str, include_anomalies: bool = True, include_spectrum: bool = True) -> dict:
    """Full analysis record for one image file. Never raises: errors go in the record."""
    try:
        img = load_image(path)
        gray = to_channel(img.pixels, "luma")
        record: dict = dict(img.meta)
        metrics = compute_metrics(gray)
        record.update(scalar_metrics(metrics))
        record["radial_profile"] = metrics["radial_profile"]
        record["orientation_histogram"] = metrics["orientation_histogram"]
        if include_anomalies:
            flags = detect_all(gray)
            record["anomaly_count"] = len(flags)
            record["max_anomaly_severity"] = round(max((f["severity"] for f in flags), default=0.0), 3)
            record["anomaly_types"] = ",".join(f["type"] for f in flags)
            record["anomalies"] = flags
        if include_spectrum:
            # small standardized log-spectrum for dataset mean / outlier distance
            small = _resize_gray(gray, _SPEC_SIZE)
            F = compute_fft(small, window="hann")
            record["_log_spectrum"] = np.log10(power_spectrum(F) + 1e-20).astype(np.float32)
            record["_spectrum_thumb"] = magnitude_display(F)
        record["error"] = None
        return record
    except Exception as exc:  # noqa: BLE001 - batch must survive any bad file
        return {
            "filename": Path(path).name,
            "path": str(path),
            "error": f"{type(exc).__name__}: {exc}",
            "_traceback": traceback.format_exc(),
        }


def run_batch(
    paths: Iterable[str | Path],
    workers: int = 0,
    include_anomalies: bool = True,
    progress: Callable[[int, int, dict], None] | None = None,
) -> list[dict]:
    """Analyze many files in parallel; calls progress(done, total, record) as results arrive."""
    paths = [str(p) for p in paths]
    total = len(paths)
    results: list[dict] = []
    if workers == 1 or total <= 2:
        for i, p in enumerate(paths):
            rec = analyze_file(p, include_anomalies=include_anomalies)
            results.append(rec)
            if progress:
                progress(i + 1, total, rec)
        return results

    max_workers = workers if workers > 0 else None
    with ProcessPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(analyze_file, p, include_anomalies): p for p in paths}
        done = 0
        for fut in as_completed(futures):
            rec = fut.result()
            results.append(rec)
            done += 1
            if progress:
                progress(done, total, rec)
    # deterministic order regardless of completion order
    order = {p: i for i, p in enumerate(paths)}
    results.sort(key=lambda r: order.get(r.get("path", ""), 1 << 30))
    return results


def dataset_statistics(records: list[dict]) -> dict:
    """Mean log-spectrum + per-image outlier scores (distance from the dataset mean).

    The mean spectrum across a dataset is the classic visualization for spotting
    shared artifacts (compression grids, generator fingerprints); the outlier
    score ranks images whose spectra deviate most from the dataset norm.
    """
    specs = [r["_log_spectrum"] for r in records if isinstance(r.get("_log_spectrum"), np.ndarray)]
    if not specs:
        return {"mean_log_spectrum": None, "outlier_scores": {}}
    stack = np.stack(specs)
    mean_spec = stack.mean(axis=0)
    std = float(stack.std()) or 1e-9
    scores = {}
    for r in records:
        spec = r.get("_log_spectrum")
        if isinstance(spec, np.ndarray):
            scores[r.get("path", r.get("filename"))] = round(
                float(np.sqrt(np.mean((spec - mean_spec) ** 2)) / std), 4
            )
    return {"mean_log_spectrum": mean_spec, "outlier_scores": scores}


def records_to_table(records: list[dict], columns: list[str] | None = None) -> list[dict]:
    """Flatten records to scalar-only rows for tabular export; drop private keys."""
    rows = []
    for r in records:
        row = {
            k: v
            for k, v in r.items()
            if not k.startswith("_") and not isinstance(v, (list, dict, np.ndarray))
        }
        if "anomalies" in r and isinstance(r["anomalies"], list):
            row["anomaly_titles"] = "; ".join(f["title"] for f in r["anomalies"])
        if columns:
            row = {k: row.get(k) for k in columns if k in row or k in (columns or [])}
        rows.append(row)
    return rows
