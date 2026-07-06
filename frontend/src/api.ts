import type { AnomalyFlag, BatchRow, ImageMeta, JobSummary, MaskSpec, Metrics } from "./types";

const BASE = "/api";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not json */
    }
    throw new Error(detail);
  }
  return res.json();
}

async function post<T>(url: string, body: unknown): Promise<T> {
  return json<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function bitmapFrom(res: Response): Promise<ImageBitmap> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return createImageBitmap(await res.blob());
}

export interface AppConfig {
  windows: Record<string, string>;
  metrics: Record<string, { label: string; group: string }>;
  preprocess: Record<string, { label: string; uses_amount: boolean; description: string }>;
  channels: string[];
  scales: string[];
  extensions: string[];
}

/** Pre-filter parameters attached to every analysis request. */
export interface PreQuery {
  preprocess: string;
  pre_amount: number;
}

export const api = {
  config: () => json<AppConfig>("/config"),
  samples: () => json<{ name: string; filename: string }[]>("/samples"),
  loadSample: (name: string) => post<{ id: string; meta: ImageMeta }>("/images/sample", { path: name }),
  loadFromPath: (path: string) => post<{ id: string; meta: ImageMeta }>("/images/from-path", { path }),

  async upload(file: File): Promise<{ id: string; meta: ImageMeta }> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/images`, { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText);
    return res.json();
  },

  pixels: (id: string, channel = "rgb", pre?: PreQuery, signal?: AbortSignal) =>
    fetch(
      `${BASE}/images/${id}/pixels.png?channel=${channel}` +
        (pre ? `&preprocess=${pre.preprocess}&pre_amount=${pre.pre_amount}` : ""),
      { signal },
    ).then(bitmapFrom),

  spectrum: (
    id: string,
    q: {
      kind: string;
      channel: string;
      window: string;
      scale: string;
      gamma: number;
      clip_lo: number;
      clip_hi: number;
    } & PreQuery,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]));
    return fetch(`${BASE}/images/${id}/spectrum.png?${params}`, { signal }).then(bitmapFrom);
  },

  bandEnergy: (
    id: string,
    body: { specs: MaskSpec[]; invert?: boolean; soft_px?: number; channel: string; window: string } & PreQuery,
    signal?: AbortSignal,
  ) =>
    fetch(`${BASE}/images/${id}/band-energy.png`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then(bitmapFrom),

  filtered: (
    id: string,
    body: { specs: MaskSpec[]; invert?: boolean; soft_px?: number; channel: string; window: string } & PreQuery,
    signal?: AbortSignal,
  ) =>
    fetch(`${BASE}/images/${id}/filter.png`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then(bitmapFrom),

  patchSpectrum: (
    id: string,
    body: { x: number; y: number; w: number; h: number; channel: string } & PreQuery,
    signal?: AbortSignal,
  ) =>
    fetch(`${BASE}/images/${id}/patch-spectrum.png`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then(bitmapFrom),

  reconstruct: (id: string, fraction: number, channel: string, window: string, pre: PreQuery, signal?: AbortSignal) =>
    fetch(
      `${BASE}/images/${id}/reconstruct.png?fraction=${fraction}&channel=${channel}&window=${window}` +
        `&preprocess=${pre.preprocess}&pre_amount=${pre.pre_amount}`,
      { signal },
    ).then(bitmapFrom),

  compareDiff: (idA: string, idB: string, channel: string) =>
    fetch(`${BASE}/compare/diff.png`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_a: idA, id_b: idB, channel }),
    }).then(bitmapFrom),

  metrics: (id: string, channel: string, pre: PreQuery) =>
    json<Metrics>(`/images/${id}/metrics?channel=${channel}&preprocess=${pre.preprocess}&pre_amount=${pre.pre_amount}`),
  anomalies: (id: string, channel: string, pre: PreQuery) =>
    json<AnomalyFlag[]>(
      `/images/${id}/anomalies?channel=${channel}&preprocess=${pre.preprocess}&pre_amount=${pre.pre_amount}`,
    ),

  fsList: (path: string) =>
    json<{ path: string; parent: string | null; dirs: string[]; image_count: number }>(
      `/fs/list?path=${encodeURIComponent(path)}`,
    ),
  startBatch: (directory: string, recursive: boolean) =>
    post<{ job_id: string; total: number }>("/batch", { directory, recursive }),
  jobStatus: (jobId: string) => json<JobSummary>(`/jobs/${jobId}`),
  jobRows: (jobId: string) => json<BatchRow[]>(`/jobs/${jobId}/rows`),
  jobRecord: (jobId: string, path: string) =>
    json<Record<string, unknown>>(`/jobs/${jobId}/record?path=${encodeURIComponent(path)}`),
  jobExportUrl: (jobId: string, format: string) => `${BASE}/jobs/${jobId}/export?format=${format}`,
  jobMeanSpectrum: (jobId: string) => fetch(`${BASE}/jobs/${jobId}/mean-spectrum.png`).then(bitmapFrom),
};

/** True for fetches cancelled by an AbortController (never worth surfacing). */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** Debounce helper for slider-driven server requests. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Serial request gate: drops stale in-flight responses (last call wins). */
export function latestOnly<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  let seq = 0;
  return async (...args: A): Promise<R | null> => {
    const mine = ++seq;
    const result = await fn(...args);
    return mine === seq ? result : null;
  };
}
