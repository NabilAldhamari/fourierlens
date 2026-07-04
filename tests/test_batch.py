"""Batch pipeline: records, dataset statistics, tabular flattening."""

import numpy as np
from PIL import Image

from fourierlens.core.batch import analyze_file, dataset_statistics, records_to_table, run_batch


def _write_samples(tmp_path, n=4):
    rng = np.random.default_rng(0)
    paths = []
    for i in range(n):
        arr = (rng.random((64, 96)) * 255).astype(np.uint8)
        p = tmp_path / f"img_{i}.png"
        Image.fromarray(arr).save(p)
        paths.append(p)
    return paths


def test_analyze_file_record(tmp_path):
    p = _write_samples(tmp_path, 1)[0]
    rec = analyze_file(str(p))
    assert rec["error"] is None
    assert rec["width"] == 96 and rec["height"] == 64
    assert rec["aspect_ratio"] == 1.5
    assert "spectral_slope" in rec and "sha256" in rec
    assert isinstance(rec["_log_spectrum"], np.ndarray)


def test_analyze_file_bad_input(tmp_path):
    bad = tmp_path / "broken.png"
    bad.write_bytes(b"not an image")
    rec = analyze_file(str(bad))
    assert rec["error"] is not None


def test_run_batch_serial_and_stats(tmp_path):
    paths = _write_samples(tmp_path)
    seen = []
    records = run_batch(paths, workers=1, progress=lambda d, t, r: seen.append((d, t)))
    assert len(records) == len(paths)
    assert seen[-1] == (len(paths), len(paths))
    stats = dataset_statistics(records)
    assert stats["mean_log_spectrum"].shape == (256, 256)
    assert len(stats["outlier_scores"]) == len(paths)

    rows = records_to_table(records)
    assert len(rows) == len(paths)
    assert all(not k.startswith("_") for row in rows for k in row)
    assert all(not isinstance(v, (list, dict, np.ndarray)) for row in rows for v in row.values())
