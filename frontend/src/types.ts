export interface ImageMeta {
  filename: string;
  format: string;
  width: number;
  height: number;
  aspect_ratio: number | null;
  megapixels: number;
  n_channels: number;
  bit_depth: number;
  file_size_bytes: number;
  sha256: string;
  path?: string;
  /** interactive analysis runs on a copy capped at 2048px on the long side */
  analysis_width?: number;
  analysis_height?: number;
  downscaled_for_analysis?: boolean;
}

export type Channel = "luma" | "r" | "g" | "b";
export type WindowName = "none" | "hann" | "hamming" | "blackman" | "tukey";
export type ScaleMode = "log" | "linear" | "gamma";
export type SpectrumKind = "magnitude" | "phase" | "psd";

/** Frequency-domain selection specs; mirror of core/masks.py. Coordinates are
 * normalized [0,1] on the shifted spectrum canvas; radii use 1.0 = Nyquist. */
export type MaskSpec =
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "annulus"; r_inner: number; r_outer: number }
  | { type: "wedge"; angle_deg: number; width_deg: number }
  | { type: "point"; x: number; y: number; r: number }
  | { type: "brush"; points: [number, number][]; r: number };

export type Tool =
  | "pan"
  | "point"
  | "rect"
  | "ellipse"
  | "annulus"
  | "wedge"
  | "brush"
  | "roi"
  | "annotate";

export type PixelViewMode = "original" | "overlay" | "filtered" | "progressive";

export interface Annotation {
  id: string;
  domain: "spectrum" | "image";
  /** rect with w=h=0 is a point annotation (single pixel / single frequency) */
  shape: { type: "rect" | "ellipse"; x: number; y: number; w: number; h: number };
  name: string;
  comment: string;
  color: string;
  visible: boolean;
  createdAt: string;
}

export interface AnomalyFlag {
  type: string;
  severity: number;
  title: string;
  explanation: string;
  locations: { x: number; y: number }[];
  peaks?: {
    x: number;
    y: number;
    fx: number;
    fy: number;
    cycles_per_px: number;
    wavelength_px: number | null;
    orientation_deg: number;
    strength_decades: number;
  }[];
  [key: string]: unknown;
}

export interface Metrics {
  [key: string]: number | string | unknown;
  radial_profile: { freqs: number[]; power: number[] };
  orientation_histogram: number[];
}

export interface HoverInfo {
  panel: "spectrum" | "image";
  nx: number;
  ny: number;
  fx: number; // normalized frequency [-1, 1]
  fy: number;
  cyclesPerPx: number;
  wavelengthPx: number | null;
  orientationDeg: number;
}

export interface SessionFile {
  version: 1;
  app: "fourierlens";
  savedAt: string;
  image: { filename: string; sha256: string; path?: string };
  settings: Record<string, unknown>;
  selections: MaskSpec[];
  annotations: Annotation[];
}

export interface BatchRow {
  filename: string;
  path: string;
  error: string | null;
  [key: string]: string | number | boolean | null | undefined;
}

export interface JobSummary {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  done: number;
  total: number;
  current_file: string | null;
  error: string | null;
  elapsed_s: number;
  n_errors: number;
}
