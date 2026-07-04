"""Background batch jobs with polled progress.

Jobs run in a daemon thread that drives the multiprocessing batch engine; the
UI polls GET /api/jobs/{id} a couple of times per second. For a local
single-user tool, polling is simpler and just as responsive as a WebSocket.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from io import BytesIO
from pathlib import Path

import numpy as np

from ..core.batch import dataset_statistics, records_to_table, run_batch
from ..core.fft import scale_magnitude, to_uint8


class BatchJob:
    def __init__(self, paths: list[str], workers: int = 0):
        self.id = uuid.uuid4().hex[:12]
        self.paths = paths
        self.workers = workers
        self.status = "pending"  # pending | running | done | failed
        self.done = 0
        self.total = len(paths)
        self.error: str | None = None
        self.started_at = time.time()
        self.records: list[dict] = []
        self.stats: dict = {}
        self.current_file: str | None = None
        self._lock = threading.Lock()

    # -- lifecycle -------------------------------------------------------

    def run(self) -> None:
        self.status = "running"
        try:
            def progress(done: int, total: int, rec: dict) -> None:
                with self._lock:
                    self.done = done
                    self.current_file = rec.get("filename")

            records = run_batch(self.paths, workers=self.workers, progress=progress)
            stats = dataset_statistics(records)
            for rec in records:
                key = rec.get("path", rec.get("filename"))
                rec["spectral_outlier_score"] = stats["outlier_scores"].get(key)
            with self._lock:
                self.records = records
                self.stats = stats
                self.status = "done"
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self.status = "failed"
                self.error = f"{type(exc).__name__}: {exc}"

    # -- views -----------------------------------------------------------

    def summary(self) -> dict:
        with self._lock:
            return {
                "id": self.id,
                "status": self.status,
                "done": self.done,
                "total": self.total,
                "current_file": self.current_file,
                "error": self.error,
                "elapsed_s": round(time.time() - self.started_at, 1),
                "n_errors": sum(1 for r in self.records if r.get("error")),
            }

    def rows(self) -> list[dict]:
        return records_to_table(self.records)

    def full_record(self, path: str) -> dict | None:
        for rec in self.records:
            if rec.get("path") == path:
                return {k: v for k, v in rec.items() if not k.startswith("_")}
        return None

    def mean_spectrum_png(self) -> bytes | None:
        from PIL import Image

        spec = self.stats.get("mean_log_spectrum")
        if spec is None:
            return None
        # spec is already log10; rescale robustly for display
        disp = to_uint8(scale_magnitude(spec - spec.min(), scale="linear", clip_lo=0.5, clip_hi=99.5))
        buf = BytesIO()
        Image.fromarray(disp, mode="L").save(buf, "PNG")
        return buf.getvalue()

    def export_bytes(self, fmt: str) -> tuple[bytes, str, str]:
        """Returns (payload, media_type, filename)."""
        import pandas as pd

        rows = self.rows()
        stem = f"fourierlens_report_{self.id}"
        if fmt == "csv":
            df = pd.DataFrame(rows)
            return (
                df.to_csv(index=False).encode("utf-8-sig"),
                "text/csv",
                f"{stem}.csv",
            )
        if fmt == "json":
            full = [{k: v for k, v in r.items() if not k.startswith("_")} for r in self.records]
            return (
                json.dumps(full, indent=2, default=_json_default).encode("utf-8"),
                "application/json",
                f"{stem}.json",
            )
        if fmt == "parquet":
            df = pd.DataFrame(rows)
            buf = BytesIO()
            df.to_parquet(buf, index=False)
            return buf.getvalue(), "application/octet-stream", f"{stem}.parquet"
        raise ValueError(f"Unknown export format: {fmt}")


def _json_default(obj):
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.floating, np.integer)):
        return obj.item()
    raise TypeError(f"not serializable: {type(obj)}")


class JobManager:
    def __init__(self):
        self._jobs: dict[str, BatchJob] = {}
        self._lock = threading.Lock()

    def start(self, paths: list[str | Path], workers: int = 0) -> BatchJob:
        job = BatchJob([str(p) for p in paths], workers=workers)
        with self._lock:
            self._jobs[job.id] = job
        threading.Thread(target=job.run, daemon=True, name=f"batch-{job.id}").start()
        return job

    def get(self, job_id: str) -> BatchJob | None:
        with self._lock:
            return self._jobs.get(job_id)
