"""Command-line interface.

    fourierlens                 -> start the local app (server + browser)
    fourierlens serve           -> same, with --port/--host/--no-browser
    fourierlens analyze IMG     -> metrics + anomaly flags for one image
    fourierlens batch DIR       -> dataset analysis with CSV/JSON/Parquet export
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _cmd_serve(args: argparse.Namespace) -> int:
    from .server.app import run_server

    run_server(
        host=args.host,
        port=args.port,
        open_browser=not args.no_browser,
        dev=getattr(args, "dev", False),
    )
    return 0


def _cmd_analyze(args: argparse.Namespace) -> int:
    from .core.anomalies import detect_all
    from .core.io import load_image, to_channel
    from .core.metrics import compute_metrics, scalar_metrics

    img = load_image(args.image)
    gray = to_channel(img.pixels, args.channel)
    metrics = compute_metrics(gray)
    flags = detect_all(gray)

    if args.json:
        out = {"meta": img.meta, "metrics": metrics, "anomalies": flags}
        print(json.dumps(out, indent=2))
        return 0

    print(f"\n{img.meta['filename']}  {img.meta['width']}x{img.meta['height']}  "
          f"{img.meta['format']}  {img.meta['bit_depth']}-bit  sha256:{img.meta['sha256']}")
    print("\nMetrics (luma channel):" if args.channel == "luma" else f"\nMetrics ({args.channel} channel):")
    for k, v in scalar_metrics(metrics).items():
        print(f"  {k:28s} {v}")
    if flags:
        print(f"\nAnomaly flags ({len(flags)}):")
        for f in flags:
            print(f"  [{f['severity']:.2f}] {f['title']}")
            print(f"         {f['explanation'][:120]}...")
    else:
        print("\nNo spectral anomalies flagged.")
    return 0


def _cmd_batch(args: argparse.Namespace) -> int:
    from .core.batch import dataset_statistics, records_to_table, run_batch
    from .core.io import iter_image_files

    root = Path(args.directory)
    paths = list(iter_image_files(root, recursive=args.recursive))
    if not paths:
        print(f"No supported images found in {root}", file=sys.stderr)
        return 1
    print(f"Analyzing {len(paths)} images with {args.workers or 'auto'} workers...")

    def progress(done: int, total: int, rec: dict) -> None:
        status = "ERR " if rec.get("error") else "ok  "
        print(f"  [{done}/{total}] {status}{rec.get('filename', '?')}")

    records = run_batch(paths, workers=args.workers, progress=progress)
    stats = dataset_statistics(records)
    for rec in records:
        key = rec.get("path", rec.get("filename"))
        rec["spectral_outlier_score"] = stats["outlier_scores"].get(key)

    rows = records_to_table(records)
    out = Path(args.export) if args.export else root / "fourierlens_report.csv"
    suffix = out.suffix.lower()
    import pandas as pd

    df = pd.DataFrame(rows)
    if suffix == ".csv":
        df.to_csv(out, index=False, encoding="utf-8-sig")  # BOM so Excel decodes UTF-8
    elif suffix == ".json":
        out.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    elif suffix == ".parquet":
        df.to_parquet(out, index=False)
    else:
        print(f"Unknown export format {suffix!r}; use .csv, .json, or .parquet", file=sys.stderr)
        return 1
    errors = sum(1 for r in records if r.get("error"))
    print(f"\nWrote {len(rows)} rows -> {out}" + (f"  ({errors} files failed)" if errors else ""))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fourierlens", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command")

    p_serve = sub.add_parser("serve", help="start the local web app (default)")
    p_serve.add_argument("--host", default="127.0.0.1")
    p_serve.add_argument("--port", type=int, default=8321)
    p_serve.add_argument("--no-browser", action="store_true", help="do not auto-open the browser")
    p_serve.add_argument("--dev", action="store_true", help="auto-reload the server when Python sources change")

    p_an = sub.add_parser("analyze", help="print metrics and anomaly flags for one image")
    p_an.add_argument("image")
    p_an.add_argument("--channel", default="luma", choices=["luma", "r", "g", "b"])
    p_an.add_argument("--json", action="store_true", help="machine-readable output")

    p_batch = sub.add_parser("batch", help="analyze a folder of images and export a dataset report")
    p_batch.add_argument("directory")
    p_batch.add_argument("--recursive", action="store_true")
    p_batch.add_argument("--workers", type=int, default=0, help="0 = one per CPU core")
    p_batch.add_argument("--export", help="output path: .csv, .json, or .parquet")

    args = parser.parse_args(argv)
    if args.command == "analyze":
        return _cmd_analyze(args)
    if args.command == "batch":
        return _cmd_batch(args)
    if args.command is None:
        args = p_serve.parse_args([])
    return _cmd_serve(args)


if __name__ == "__main__":
    raise SystemExit(main())
