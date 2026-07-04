import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { applyColormap } from "../colormaps";
import { useApp, useExplore } from "../store";
import type { BatchRow, JobSummary } from "../types";

/** Columns shown by default; the chooser can enable everything else. */
const DEFAULT_COLUMNS = [
  "filename", "width", "height", "aspect_ratio", "format",
  "spectral_slope", "hf_energy_ratio", "blur_score",
  "anomaly_count", "max_anomaly_severity", "spectral_outlier_score",
];

const NUMERIC_HINTS: Record<string, string> = {
  spectral_slope: "P ∝ 1/f^α; natural ≈ 2. Low = sharp/synthetic, high = blurry/upscaled",
  hf_energy_ratio: "share of energy above half Nyquist",
  blur_score: "variance of Laplacian — higher = sharper",
  spectral_outlier_score: "distance of this image's spectrum from the dataset mean (higher = more unusual)",
  max_anomaly_severity: "strongest anomaly flag on this image",
};

export default function BatchPage() {
  const [dir, setDir] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [meanSpec, setMeanSpec] = useState<ImageBitmap | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const pollRef = useRef<number | undefined>(undefined);

  const start = async () => {
    setError(null);
    setRows([]);
    setMeanSpec(null);
    try {
      const { job_id } = await api.startBatch(dir, recursive);
      poll(job_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const poll = useCallback((jobId: string) => {
    window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const summary = await api.jobStatus(jobId);
        setJob(summary);
        if (summary.status === "done" || summary.status === "failed") {
          window.clearInterval(pollRef.current);
          if (summary.status === "done") {
            setRows(await api.jobRows(jobId));
            api.jobMeanSpectrum(jobId).then((bm) => applyColormap(bm, "viridis")).then(setMeanSpec).catch(() => {});
          } else {
            setError(summary.error);
          }
        }
      } catch (e) {
        window.clearInterval(pollRef.current);
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 400);
  }, []);

  useEffect(() => () => window.clearInterval(pollRef.current), []);

  return (
    <div className="batch-page">
      <div className="batch-controls">
        <input
          className="dir-input"
          placeholder="dataset folder, e.g. D:\datasets\train"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && dir && start()}
        />
        <button className="btn" onClick={() => setBrowsing(true)}>browse…</button>
        <label className="check">
          <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
          include subfolders
        </label>
        <button className="btn primary" disabled={!dir || job?.status === "running"} onClick={start}>
          ▶ analyze folder
        </button>
        {job && job.status === "done" && (
          <>
            <span className="spacer" />
            {(["csv", "json", "parquet"] as const).map((fmt) => (
              <a key={fmt} className="btn" href={api.jobExportUrl(job.id, fmt)} download>
                ⬇ {fmt}
              </a>
            ))}
          </>
        )}
      </div>

      {error && <div className="error-banner" onClick={() => setError(null)}>⚠ {error}</div>}

      {job && job.status === "running" && (
        <div className="progress-wrap">
          <div className="progress">
            <div className="progress-fill" style={{ width: `${(job.done / Math.max(job.total, 1)) * 100}%` }} />
          </div>
          <span>
            {job.done}/{job.total} · {job.current_file ?? ""} · {job.elapsed_s}s
          </span>
        </div>
      )}

      {rows.length > 0 && job && (
        <div className="batch-results">
          <div className="dataset-summary">
            {meanSpec && <MeanSpectrumCard bitmap={meanSpec} />}
            <div className="dataset-stats">
              <h3>Dataset</h3>
              <p>{rows.length} images{job.n_errors > 0 && <span className="warn"> · {job.n_errors} failed</span>}</p>
              <p className="muted small">
                The mean log-spectrum reveals artifacts shared across the dataset (compression
                grids, generator fingerprints, sensor patterns). Sort by <b>outlier score</b> to
                find images whose frequency content deviates most from the dataset norm, or by
                <b> anomaly severity</b> to triage flagged images. Click a row to open it in the
                explorer.
              </p>
            </div>
          </div>
          <ResultsTable rows={rows} jobId={job.id} />
        </div>
      )}

      {!job && (
        <div className="welcome">
          <h2>Batch dataset analysis</h2>
          <p>
            Point FourierLens at a folder of images to compute frequency metrics, flag spectral
            anomalies, and export a per-image report (CSV / JSON / Parquet) — plus dataset-level
            statistics like the mean spectrum and per-image outlier scores.
          </p>
          <p className="muted small">Also available headless: <code>fourierlens batch ./data --recursive --export report.parquet</code></p>
        </div>
      )}

      {browsing && (
        <FolderBrowser
          initial={dir}
          onPick={(p) => {
            setDir(p);
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}

function MeanSpectrumCard({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bitmap, 0, 0, 220, 220);
    }
  }, [bitmap]);
  return (
    <figure className="mean-spec">
      <canvas ref={ref} width={220} height={220} />
      <figcaption>dataset mean log-spectrum</figcaption>
    </figure>
  );
}

const helper = createColumnHelper<BatchRow>();

function ResultsTable({ rows, jobId }: { rows: BatchRow[]; jobId: string }) {
  const allKeys = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  ).filter((k) => k !== "path" && k !== "error");

  const [visible, setVisible] = useState<string[]>(DEFAULT_COLUMNS.filter((c) => allKeys.includes(c)));
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const setTab = useApp((s) => s.setTab);
  const setImage = useExplore((s) => s.setImage);

  const columns = visible.map((key) =>
    helper.accessor((row) => row[key], {
      id: key,
      header: key.replace(/_/g, " "),
      cell: (info) => {
        const v = info.getValue();
        if (v == null) return <span className="muted">–</span>;
        if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(4);
        return String(v);
      },
    }),
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onGlobalFilterChange: setFilter,
    globalFilterFn: (row, _col, value) =>
      String(row.original.filename ?? "").toLowerCase().includes(String(value).toLowerCase()),
  });

  const openInExplorer = async (row: BatchRow) => {
    try {
      const { id, meta } = await api.loadFromPath(row.path);
      setImage(id, meta);
      setTab("explore");
    } catch {
      /* file may have moved */
    }
  };

  void jobId;

  return (
    <div className="table-zone">
      <div className="table-tools">
        <input placeholder="filter by filename…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn" onClick={() => setChooserOpen(!chooserOpen)}>
          ☰ columns ({visible.length}/{allKeys.length})
        </button>
      </div>
      {chooserOpen && (
        <div className="column-chooser">
          {allKeys.map((k) => (
            <label key={k} className="check small">
              <input
                type="checkbox"
                checked={visible.includes(k)}
                onChange={(e) =>
                  setVisible(e.target.checked ? [...visible, k] : visible.filter((v) => v !== k))
                }
              />
              {k}
            </label>
          ))}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    title={NUMERIC_HINTS[h.column.id] ?? ""}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={row.original.error ? "row-error" : ""}
                onClick={() => !row.original.error && openInExplorer(row.original)}
                title={row.original.error ?? "click to open in explorer"}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FolderBrowser({ initial, onPick, onClose }: {
  initial: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ path: string; parent: string | null; dirs: string[]; image_count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = useCallback((path: string) => {
    api.fsList(path).then((s) => {
      setState(s);
      setError(null);
    }).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => go(initial), [go, initial]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal browser" onClick={(e) => e.stopPropagation()}>
        <h3>Choose dataset folder</h3>
        {error && <p className="warn">{error}</p>}
        {state && (
          <>
            <p className="path-line"><code>{state.path}</code></p>
            <p className="muted small">{state.image_count} supported image(s) directly in this folder</p>
            <div className="dir-list">
              {state.parent && <button onClick={() => go(state.parent!)}>⬆ ..</button>}
              {state.dirs.map((d) => (
                <button key={d} onClick={() => go(`${state.path.replace(/[\\/]+$/, "")}\\${d}`)}>📁 {d}</button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>cancel</button>
              <button className="btn primary" onClick={() => onPick(state.path)}>use this folder</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
