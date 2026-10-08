import { create } from "zustand";
import type { Config, Findings, LoadedImage, Space, ViewInfo } from "./api";

export type Tool = "move" | "rect" | "ellipse" | "arrow" | "pen" | "text";
export type ShapeKind = Exclude<Tool, "move">;

export interface Annotation {
  id: string;
  kind: ShapeKind;
  space: Space;
  color: string;
  /** image-pixel coordinates; two points for shapes, many for pen, one for text */
  points: [number, number][];
  text: string;
}

export type AnnotationDraft = Omit<Annotation, "id">;

export const COLORS = ["#ff4d6d", "#ffd23f", "#3ee8d0", "#ffffff"];

interface State {
  config: Config | null;
  image: LoadedImage | null;
  findings: Findings | null;
  tab: string; // "overview" or a tab id from the config
  viewByTab: Record<string, string>;
  paramByView: Record<string, number>;
  compare: boolean;
  crosshair: boolean;
  tool: Tool;
  color: string;
  annotations: Annotation[];
  history: Annotation[][];
  error: string | null;
  busy: boolean;

  setConfig(c: Config): void;
  setImage(img: LoadedImage): void;
  setFindings(f: Findings | null): void;
  setTab(tab: string): void;
  setView(tab: string, view: string): void;
  setParam(view: string, value: number): void;
  toggleCompare(): void;
  toggleCrosshair(): void;
  setTool(t: Tool): void;
  setColor(c: string): void;
  addAnnotation(a: AnnotationDraft): void;
  updateAnnotation(id: string, patch: Partial<Annotation>): void;
  removeAnnotation(id: string): void;
  clearAnnotations(): void;
  undo(): void;
  setError(e: string | null): void;
  setBusy(b: boolean): void;
}

let nextId = 1;

export const useApp = create<State>((set, get) => ({
  config: null,
  image: null,
  findings: null,
  tab: "overview",
  viewByTab: {},
  paramByView: {},
  compare: true,
  crosshair: false,
  tool: "move",
  color: COLORS[0],
  annotations: [],
  history: [],
  error: null,
  busy: false,

  setConfig: (config) => {
    const viewByTab: Record<string, string> = {};
    const paramByView: Record<string, number> = {};
    for (const v of config.views) {
      viewByTab[v.tab] ??= v.id;
      if (v.param) paramByView[v.id] = v.param.default;
    }
    set({ config, viewByTab, paramByView });
  },
  setImage: (image) =>
    set({ image, findings: null, tab: "overview", annotations: [], history: [], error: null, tool: "move" }),
  setFindings: (findings) => set({ findings }),
  setTab: (tab) => set({ tab }),
  setView: (tab, view) => set({ tab, viewByTab: { ...get().viewByTab, [tab]: view } }),
  setParam: (view, value) => set({ paramByView: { ...get().paramByView, [view]: value } }),
  toggleCompare: () => set({ compare: !get().compare }),
  toggleCrosshair: () => set({ crosshair: !get().crosshair }),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),

  addAnnotation: (a) => {
    const { annotations, history } = get();
    set({ history: [...history, annotations], annotations: [...annotations, { ...a, id: `a${nextId++}` }] });
  },
  updateAnnotation: (id, patch) =>
    set({ annotations: get().annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)) }),
  removeAnnotation: (id) => {
    const { annotations, history } = get();
    set({ history: [...history, annotations], annotations: annotations.filter((a) => a.id !== id) });
  },
  clearAnnotations: () => {
    const { annotations, history } = get();
    if (annotations.length) set({ history: [...history, annotations], annotations: [] });
  },
  undo: () => {
    const { history } = get();
    if (history.length) set({ annotations: history[history.length - 1], history: history.slice(0, -1) });
  },
  setError: (error) => set({ error }),
  setBusy: (busy) => set({ busy }),
}));

export function viewsInTab(config: Config, tab: string): ViewInfo[] {
  return config.views.filter((v) => v.tab === tab);
}

/** The view selected in the current tab, or null on the overview. */
export function useCurrentView(): ViewInfo | null {
  const config = useApp((s) => s.config);
  const tab = useApp((s) => s.tab);
  const selected = useApp((s) => s.viewByTab[s.tab]);
  if (!config) return null;
  const views = viewsInTab(config, tab);
  return views.find((v) => v.id === selected) ?? views[0] ?? null;
}

