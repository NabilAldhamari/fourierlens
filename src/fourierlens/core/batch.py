"""Batch analysis: per-image records + dataset-level statistics.

The worker function is module-level so ProcessPoolExecutor can pickle it on
Windows (spawn). Results are plain dicts ready for pandas/JSON.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image

from .anomalies import detect_all
from .fft import compute_fft, power_spectrum, to_uint8
from .io import load_image, to_channel
from .metrics import compute_metrics, scalar_metrics

# Spectrum size used for the dataset mean-spectrum and outlier analysis.
_SPEC_SIZE = 256

Progress = Callable[[int, int, dict], None]


def run_batch(paths: Iterable[str | Path], workers: int = 0, progress: Progress | None = None) -> list[dict]:
    """Analyze many files in parallel; calls progress(done, total, record) as results arrive.

    workers=0 uses one process per CPU core; workers=1 runs serially.
    """
    paths = [str(p) for p in paths]
    if workers == 1 or len(paths) <= 2:
        results = _analyze_serially(paths, progress)
    else:
        results = _analyze_in_parallel(paths, workers or None, progress)
    order = {p: i for i, p in enumerate(paths)}
    return sorted(results, key=lambda r: order[r["path"]])


def _analyze_serially(paths: list[str], progress: Progress | None) -> list[dict]:
    results = []
    for done, path in enumerate(paths, start=1):
        results.append(analyze_file(path))
        if progress:
            progress(done, len(paths), results[-1])
    return results


def _analyze_in_parallel(paths: list[str], max_workers: int | None, progress: Progress | None) -> list[dict]:
    results = []
    with ProcessPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(analyze_file, p) for p in paths]
        for done, future in enumerate(as_completed(futures), start=1):
            results.append(future.result())
            if progress:
                progress(done, len(paths), results[-1])
    return results


def analyze_file(path: str) -> dict:
    """Full analysis record for one image file. Never raises: errors go in the record."""
    try:
        img = load_image(path)
        gray = to_channel(img.pixels, "luma")
        metrics = compute_metrics(gray)
        flags = detect_all(gray)
        return {
            **img.meta,
            **scalar_metrics(metrics),
            "radial_profile": metrics["radial_profile"],
            "orientation_histogram": metrics["orientation_histogram"],
            "anomaly_count": len(flags),
            "max_anomaly_severity": round(max((f["severity"] for f in flags), default=0.0), 3),
            "anomaly_types": ",".join(f["type"] for f in flags),
            "anomalies": flags,
            "_log_spectrum": _small_log_spectrum(gray),
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001 - batch must survive any bad file
        return {"filename": Path(path).name, "path": str(path), "error": f"{type(exc).__name__}: {exc}"}


def _small_log_spectrum(gray: np.ndarray) -> np.ndarray:
    """Fixed-size log-spectrum so images of any size can be compared."""
    small = Image.fromarray(to_uint8(gray)).resize((_SPEC_SIZE, _SPEC_SIZE), Image.BILINEAR)
    F = compute_fft(np.asarray(small, dtype=np.float32) / 255.0, window="hann")
    return np.log10(power_spectrum(F) + 1e-20).astype(np.float32)


def dataset_statistics(records: list[dict]) -> dict:
    """Mean log-spectrum + per-image outlier scores (distance from the dataset mean).

    The mean spectrum across a dataset is the classic visualization for spotting
    shared artifacts (compression grids, generator fingerprints); the outlier
    score ranks images whose spectra deviate most from the dataset norm.
    Scores are keyed by record path.
    """
    analyzed = [r for r in records if r.get("_log_spectrum") is not None]
    if not analyzed:
        return {"mean_log_spectrum": None, "outlier_scores": {}}
    stack = np.stack([r["_log_spectrum"] for r in analyzed])
    mean_spec = stack.mean(axis=0)
    std = float(stack.std()) or 1e-9
    scores = {
        r["path"]: round(float(np.sqrt(np.mean((r["_log_spectrum"] - mean_spec) ** 2)) / std), 4)
        for r in analyzed
    }
    return {"mean_log_spectrum": mean_spec, "outlier_scores": scores}


def records_to_table(records: list[dict]) -> list[dict]:
    """Flatten records to scalar-only rows for tabular export; drop private keys."""
    rows = []
    for r in records:
        row = {
            k: v
            for k, v in r.items()
            if not k.startswith("_") and not isinstance(v, (list, dict, np.ndarray))
        }
        if "anomalies" in r:
            row["anomaly_titles"] = "; ".join(f["title"] for f in r["anomalies"])
        rows.append(row)
    return rows
