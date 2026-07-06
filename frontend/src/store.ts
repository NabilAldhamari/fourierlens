import { create } from "zustand";
import type {
  Annotation,
  AnomalyFlag,
  Channel,
  HoverInfo,
  ImageMeta,
  MaskSpec,
  Metrics,
  PixelViewMode,
  ScaleMode,
  SessionFile,
  SpectrumKind,
  Tool,
  WindowName,
} from "./types";

let annotationCounter = 0;

export interface ExploreState {
  // image identity
  imageId: string | null;
  meta: ImageMeta | null;
  error: string | null;

  // pre-filtering (applied to the channel before every analysis/view)
  preprocess: string;
  preAmount: number;

  // spectrum display settings
  channel: Channel;
  window: WindowName;
  kind: SpectrumKind;
  scale: ScaleMode;
  gamma: number;
  clipLo: number;
  clipHi: number;
  spectrumColormap: string;

  // overlay (frequency -> pixel) settings
  overlayColormap: string;
  overlayOpacity: number;
  invert: boolean;
  softPx: number;

  // pixel panel
  pixelView: PixelViewMode;
  progressiveFraction: number;
  compareSlider: number;

  // tools
  tool: Tool;
  pointRadius: number;
  wedgeWidth: number;
  brushRadius: number;

  // working data
  selections: MaskSpec[];
  annotations: Annotation[];
  hover: HoverInfo | null;
  metrics: Metrics | null;
  anomalies: AnomalyFlag[];
  roiRect: { x: number; y: number; w: number; h: number } | null;

  // actions
  set: (partial: Partial<ExploreState>) => void;
  setImage: (id: string, meta: ImageMeta) => void;
  addSelection: (spec: MaskSpec) => void;
  removeSelection: (index: number) => void;
  clearSelections: () => void;
  addAnnotation: (a: Omit<Annotation, "id" | "createdAt" | "visible">) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  sessionObject: () => SessionFile | null;
  applySession: (s: SessionFile) => void;
}

const DEFAULT_SETTINGS = {
  preprocess: "none",
  preAmount: 1.0,
  channel: "luma" as Channel,
  window: "hann" as WindowName,
  kind: "magnitude" as SpectrumKind,
  scale: "log" as ScaleMode,
  gamma: 0.5,
  clipLo: 0.1,
  clipHi: 99.9,
  spectrumColormap: "viridis",
  overlayColormap: "inferno",
  overlayOpacity: 0.6,
  invert: false,
  softPx: 2,
  pixelView: "original" as PixelViewMode,
  progressiveFraction: 0.15,
  compareSlider: 0.5,
  tool: "pan" as Tool,
  pointRadius: 0.03,
  wedgeWidth: 15,
  brushRadius: 0.03,
};

export const useExplore = create<ExploreState>((set, get) => ({
  imageId: null,
  meta: null,
  error: null,
  ...DEFAULT_SETTINGS,
  selections: [],
  annotations: [],
  hover: null,
  metrics: null,
  anomalies: [],
  roiRect: null,

  set: (partial) => set(partial),

  setImage: (id, meta) =>
    set({
      imageId: id,
      meta,
      error: null,
      selections: [],
      annotations: [],
      metrics: null,
      anomalies: [],
      roiRect: null,
      hover: null,
      pixelView: "original",
    }),

  addSelection: (spec) =>
    set({
      selections: [...get().selections, spec],
      // first selection: flip the left panel to the overlay so the user
      // immediately SEES what selecting a frequency region does
      pixelView: get().pixelView === "original" ? "overlay" : get().pixelView,
    }),
  removeSelection: (index) => set({ selections: get().selections.filter((_, i) => i !== index) }),
  clearSelections: () => set({ selections: [], invert: false }),

  addAnnotation: (a) =>
    set({
      annotations: [
        ...get().annotations,
        { ...a, id: `ann-${Date.now()}-${annotationCounter++}`, visible: true, createdAt: new Date().toISOString() },
      ],
    }),
  updateAnnotation: (id, patch) =>
    set({ annotations: get().annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)) }),
  removeAnnotation: (id) => set({ annotations: get().annotations.filter((a) => a.id !== id) }),

  sessionObject: () => {
    const s = get();
    if (!s.meta) return null;
    return {
      version: 1,
      app: "fourierlens",
      savedAt: new Date().toISOString(),
      image: { filename: s.meta.filename, sha256: s.meta.sha256, path: s.meta.path },
      settings: {
        preprocess: s.preprocess,
        preAmount: s.preAmount,
        channel: s.channel,
        window: s.window,
        kind: s.kind,
        scale: s.scale,
        gamma: s.gamma,
        clipLo: s.clipLo,
        clipHi: s.clipHi,
        spectrumColormap: s.spectrumColormap,
        overlayColormap: s.overlayColormap,
        overlayOpacity: s.overlayOpacity,
        invert: s.invert,
        softPx: s.softPx,
        pixelView: s.pixelView,
      },
      selections: s.selections,
      annotations: s.annotations,
    };
  },

  applySession: (session) => {
    const settings = session.settings as Partial<ExploreState>;
    set({
      ...settings,
      selections: session.selections ?? [],
      annotations: session.annotations ?? [],
    });
  },
}));

export type Tab = "explore" | "batch" | "compare" | "help";

interface AppState {
  tab: Tab;
  setTab: (tab: Tab) => void;
}

export const useApp = create<AppState>((set) => ({
  tab: "explore",
  setTab: (tab) => set({ tab }),
}));
