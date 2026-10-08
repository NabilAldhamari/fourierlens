// Typed client for the local FourierLens API.

export type Space = "image" | "spectrum";

export interface ViewParam {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface ViewInfo {
  id: string;
  tab: string;
  label: string;
  look_for: string;
  method: string;
  reference: string;
  space: Space;
  param: ViewParam | null;
}

export interface Config {
  tabs: { id: string; label: string }[];
  views: ViewInfo[];
  version: string;
  extensions: string[];
}

export interface ImageMeta {
  filename: string;
  format: string;
  width: number;
  height: number;
  analysis_width: number;
  analysis_height: number;
  downscaled_for_analysis: boolean;
  bit_depth: number;
  file_size_bytes: number;
  sha256: string;
  jpeg_quality?: number | null;
  has_exif?: boolean;
  camera_make?: string;
  camera_model?: string;
  software?: string;
  date_time?: string;
  generator_metadata?: string[];
}

export interface LoadedImage {
  id: string;
  meta: ImageMeta;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Flag {
  type: string;
  severity: number;
  title: string;
  explanation: string;
  view: string | null;
  region?: Region;
}

export interface Findings {
  flags: Flag[];
  spectrum: { freqs: number[]; log_power: number[]; fit: number[] | null; alpha: number | null; r2: number };
}

export interface Sample {
  name: string;
  filename: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  config: () => fetch("/api/config").then((r) => json<Config>(r)),
  samples: () => fetch("/api/samples").then((r) => json<Sample[]>(r)),
  sampleThumb: (name: string) => `/api/samples/${encodeURIComponent(name)}/thumb.png`,
  loadSample: (name: string) =>
    fetch("/api/images/sample", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => json<LoadedImage>(r)),
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return fetch("/api/images", { method: "POST", body }).then((r) => json<LoadedImage>(r));
  },
  findings: (id: string) => fetch(`/api/images/${id}/findings`).then((r) => json<Findings>(r)),
  originalUrl: (id: string) => `/api/images/${id}/original.png`,
  viewUrl: (id: string, view: ViewInfo, value?: number) =>
    `/api/images/${id}/views/${view.id}.png` + (view.param && value !== undefined ? `?${view.param.name}=${value}` : ""),
};
