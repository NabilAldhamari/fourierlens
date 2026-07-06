import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isAbort, type AppConfig } from "../api";
import { applyColormap } from "../colormaps";
import { ACCENT, drawAnnotation, drawAnomalyMarkers, drawCrosshair, drawSpec } from "../draw";
import { useExplore } from "../store";
import type { Annotation, AnomalyFlag, HoverInfo, MaskSpec } from "../types";
import CanvasPanel, { createSharedView, type PanelPointer } from "./CanvasPanel";
import { OverlayControls, PreprocessControls, SpectrumControls, Toolbar, ToolHintBar } from "./Controls";
import GratingPreview from "./GratingPreview";
import { AnnotationsTab, AnomaliesTab, MetricsTab, SelectionsTab } from "./Sidebar";

type SidebarTab = "annotations" | "selections" | "metrics" | "anomalies";

interface PendingAnnotation {
  domain: "spectrum" | "image";
  shape: Annotation["shape"];
}

export default function ExplorePage({
  windowDescriptions,
  preprocessOps,
}: {
  windowDescriptions: Record<string, string>;
  preprocessOps: AppConfig["preprocess"];
}) {
  const s = useExplore();
  // one transform shared by both panels: zoom/pan anywhere moves both together
  const sharedView = useMemo(createSharedView, []);
  const [samples, setSamples] = useState<{ name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  // bitmaps (view-model only; never serialized)
  const [pixelBitmap, setPixelBitmap] = useState<ImageBitmap | null>(null);
  const [spectrumGray, setSpectrumGray] = useState<ImageBitmap | null>(null);
  const [spectrumBitmap, setSpectrumBitmap] = useState<ImageBitmap | null>(null);
  const [overlayGray, setOverlayGray] = useState<ImageBitmap | null>(null);
  const [overlayBitmap, setOverlayBitmap] = useState<ImageBitmap | null>(null);
  const [filteredBitmap, setFilteredBitmap] = useState<ImageBitmap | null>(null);
  const [progressiveBitmap, setProgressiveBitmap] = useState<ImageBitmap | null>(null);
  const [patchBitmap, setPatchBitmap] = useState<ImageBitmap | null>(null);

  const [draft, setDraft] = useState<MaskSpec | null>(null);
  const [draftAnn, setDraftAnn] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pending, setPending] = useState<PendingAnnotation | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("anomalies");
  const [showMarkers, setShowMarkers] = useState(true);
  const dragStart = useRef<{ nx: number; ny: number } | null>(null);
  const brushPoints = useRef<[number, number][]>([]);

  const hasSelection = s.selections.length > 0 || s.invert;

  // ------------------------------------------------------------------ loading

  useEffect(() => {
    api.samples().then(setSamples).catch(() => setSamples([]));
  }, []);

  const loadVia = useCallback(
    async (loader: Promise<{ id: string; meta: import("../types").ImageMeta }>) => {
      setBusy(true);
      try {
        const { id, meta } = await loader;
        s.setImage(id, meta);
      } catch (e) {
        s.set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    },
    [s],
  );

  const onUploadFile = useCallback(
    (file: File) => void loadVia(api.upload(file)),
    [loadVia],
  );

  // global drag & drop + paste
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) onUploadFile(file);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) onUploadFile(file);
    };
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("paste", onPaste);
    };
  }, [onUploadFile]);

  // ------------------------------------------------------------------ fetch effects

  // base pixels (shows the pre-filtered channel when a pre-filter is active,
  // so the left panel is always exactly what the spectrum analyzes)
  useEffect(() => {
    if (!s.imageId) return;
    const ctl = new AbortController();
    api
      .pixels(s.imageId, "rgb", { preprocess: s.preprocess, pre_amount: s.preAmount }, ctl.signal)
      .then((bm) => setPixelBitmap(bm))
      .catch((e) => !isAbort(e) && s.set({ error: `image view: ${e instanceof Error ? e.message : e}` }));
    return () => ctl.abort();
  }, [s.imageId, s.preprocess, s.preAmount]);

  // spectrum (debounced: sliders fire fast; superseded requests are aborted so
  // they neither pile up on the server nor surface as errors)
  useEffect(() => {
    if (!s.imageId) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api
        .spectrum(
          s.imageId!,
          {
            kind: s.kind,
            channel: s.channel,
            window: s.window,
            scale: s.scale,
            gamma: s.gamma,
            clip_lo: s.clipLo,
            clip_hi: s.clipHi,
            preprocess: s.preprocess,
            pre_amount: s.preAmount,
          },
          ctl.signal,
        )
        .then((bm) => setSpectrumGray(bm))
        .catch((e) => !isAbort(e) && s.set({ error: `spectrum: ${e instanceof Error ? e.message : e}` }));
    }, 120);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [s.imageId, s.kind, s.channel, s.window, s.scale, s.gamma, s.clipLo, s.clipHi, s.preprocess, s.preAmount]);

  // colorize spectrum client-side
  useEffect(() => {
    if (!spectrumGray) return;
    let live = true;
    applyColormap(spectrumGray, s.spectrumColormap).then((bm) => live && setSpectrumBitmap(bm));
    return () => {
      live = false;
    };
  }, [spectrumGray, s.spectrumColormap]);

  // metrics + anomalies
  useEffect(() => {
    if (!s.imageId) return;
    let live = true;
    const pre = { preprocess: s.preprocess, pre_amount: s.preAmount };
    api.metrics(s.imageId, s.channel, pre).then((m) => live && s.set({ metrics: m })).catch(() => {});
    api.anomalies(s.imageId, s.channel, pre).then((a) => live && s.set({ anomalies: a })).catch(() => {});
    return () => {
      live = false;
    };
  }, [s.imageId, s.channel, s.preprocess, s.preAmount]);

  // band-energy overlay (frequency -> pixel localization)
  useEffect(() => {
    if (!s.imageId || !hasSelection) {
      setOverlayGray(null);
      setOverlayBitmap(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api
        .bandEnergy(
          s.imageId!,
          {
            specs: s.selections,
            invert: s.invert,
            soft_px: s.softPx,
            channel: s.channel,
            // always the unwindowed FFT: a window's taper would masquerade as
            // "energy fading toward the borders" in the localization map
            window: "none",
            preprocess: s.preprocess,
            pre_amount: s.preAmount,
          },
          ctl.signal,
        )
        .then((bm) => setOverlayGray(bm))
        .catch((e) => !isAbort(e) && s.set({ error: `overlay: ${e instanceof Error ? e.message : e}` }));
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [s.imageId, s.selections, s.invert, s.softPx, s.channel, s.preprocess, s.preAmount, hasSelection]);

  useEffect(() => {
    if (!overlayGray) {
      setOverlayBitmap(null);
      return;
    }
    let live = true;
    applyColormap(overlayGray, s.overlayColormap, true).then((bm) => live && setOverlayBitmap(bm));
    return () => {
      live = false;
    };
  }, [overlayGray, s.overlayColormap]);

  // filtered reconstruction
  useEffect(() => {
    if (!s.imageId || s.pixelView !== "filtered" || !hasSelection) {
      setFilteredBitmap(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api
        .filtered(
          s.imageId!,
          {
            specs: s.selections,
            invert: s.invert,
            soft_px: s.softPx,
            channel: s.channel,
            window: "none", // reconstructions must not inherit the display window's vignette
            preprocess: s.preprocess,
            pre_amount: s.preAmount,
          },
          ctl.signal,
        )
        .then((bm) => setFilteredBitmap(bm))
        .catch((e) => !isAbort(e) && s.set({ error: `filter: ${e instanceof Error ? e.message : e}` }));
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [s.imageId, s.pixelView, s.selections, s.invert, s.softPx, s.channel, s.preprocess, s.preAmount, hasSelection]);

  // progressive reconstruction
  useEffect(() => {
    if (!s.imageId || s.pixelView !== "progressive") {
      setProgressiveBitmap(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api
        .reconstruct(
          s.imageId!,
          s.progressiveFraction,
          s.channel,
          "none",
          { preprocess: s.preprocess, pre_amount: s.preAmount },
          ctl.signal,
        )
        .then((bm) => setProgressiveBitmap(bm))
        .catch((e) => !isAbort(e) && s.set({ error: `rebuild: ${e instanceof Error ? e.message : e}` }));
    }, 100);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [s.imageId, s.pixelView, s.progressiveFraction, s.channel, s.preprocess, s.preAmount]);

  // localized patch spectrum (pixel -> frequency)
  useEffect(() => {
    if (!s.imageId || !s.roiRect || !s.meta) {
      setPatchBitmap(null);
      return;
    }
    const ctl = new AbortController();
    // ROI coordinates are normalized; the server works on the (possibly
    // downscaled) analysis copy, so convert using the analysis dimensions
    const width = (s.meta.analysis_width as number | undefined) ?? s.meta.width;
    const height = (s.meta.analysis_height as number | undefined) ?? s.meta.height;
    api
      .patchSpectrum(
        s.imageId,
        {
          x: Math.round(s.roiRect.x * width),
          y: Math.round(s.roiRect.y * height),
          w: Math.round(s.roiRect.w * width),
          h: Math.round(s.roiRect.h * height),
          channel: s.channel,
          preprocess: s.preprocess,
          pre_amount: s.preAmount,
        },
        ctl.signal,
      )
      .then((bm) => setPatchBitmap(bm))
      .catch((e) => !isAbort(e) && s.set({ error: `region FFT: ${e instanceof Error ? e.message : e}` }));
    return () => ctl.abort();
  }, [s.imageId, s.roiRect, s.channel, s.meta, s.preprocess, s.preAmount]);

  // ------------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
      const st = useExplore.getState();
      if (e.key === "v" || e.key === "V") {
        const order = ["original", "overlay", "filtered", "progressive"] as const;
        st.set({ pixelView: order[(order.indexOf(st.pixelView) + 1) % order.length] });
      } else if (e.key === "[") {
        st.set({ overlayOpacity: Math.max(0, st.overlayOpacity - 0.1) });
      } else if (e.key === "]") {
        st.set({ overlayOpacity: Math.min(1, st.overlayOpacity + 0.1) });
      } else if (e.key === "Escape") {
        setDraft(null);
        setDraftAnn(null);
        setPending(null);
        dragStart.current = null;
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        if (st.selections.length) st.removeSelection(st.selections.length - 1);
        e.preventDefault();
      } else {
        const tools = ["pan", "point", "rect", "ellipse", "annulus", "wedge", "brush", "roi", "annotate"] as const;
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < tools.length) st.set({ tool: tools[idx] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ------------------------------------------------------------------ pointer logic

  const freqDist = (nx: number, ny: number) => Math.hypot((nx - 0.5) * 2, (ny - 0.5) * 2);

  const spectrumPointer = useCallback(
    (e: PanelPointer) => {
      if (e.kind === "leave") {
        s.set({ hover: null });
        return;
      }
      const fx = (e.nx - 0.5) * 2;
      const fy = (e.ny - 0.5) * 2;
      const cyc = Math.hypot(fx, fy) * 0.5;
      const hover: HoverInfo = {
        panel: "spectrum",
        nx: e.nx,
        ny: e.ny,
        fx,
        fy,
        cyclesPerPx: cyc,
        wavelengthPx: cyc > 1e-6 ? 1 / cyc : null,
        orientationDeg: ((Math.atan2(fy, fx) * 180) / Math.PI + 180) % 180,
      };
      s.set({ hover });

      const tool = s.tool;
      if (tool === "pan" || tool === "roi") return;

      if (e.kind === "down") {
        dragStart.current = { nx: e.nx, ny: e.ny };
        if (tool === "point") {
          s.addSelection({ type: "point", x: e.nx, y: e.ny, r: s.pointRadius });
          dragStart.current = null;
        } else if (tool === "brush") {
          brushPoints.current = [[e.nx, e.ny]];
          setDraft({ type: "brush", points: [...brushPoints.current], r: s.brushRadius });
        }
        return;
      }

      const start = dragStart.current;
      if (!start) return;

      if (e.kind === "move" && e.buttons & 1) {
        if (tool === "rect") {
          setDraft({
            type: "rect",
            x: Math.min(start.nx, e.nx),
            y: Math.min(start.ny, e.ny),
            w: Math.abs(e.nx - start.nx),
            h: Math.abs(e.ny - start.ny),
          });
        } else if (tool === "ellipse") {
          setDraft({
            type: "ellipse",
            cx: (start.nx + e.nx) / 2,
            cy: (start.ny + e.ny) / 2,
            rx: Math.abs(e.nx - start.nx) / 2,
            ry: Math.abs(e.ny - start.ny) / 2,
          });
        } else if (tool === "annulus") {
          const r0 = freqDist(start.nx, start.ny);
          const r1 = freqDist(e.nx, e.ny);
          setDraft({ type: "annulus", r_inner: Math.min(r0, r1), r_outer: Math.max(r0, r1) });
        } else if (tool === "wedge") {
          const angle = (Math.atan2(e.ny - 0.5, e.nx - 0.5) * 180) / Math.PI;
          setDraft({ type: "wedge", angle_deg: ((angle % 180) + 180) % 180, width_deg: s.wedgeWidth });
        } else if (tool === "brush") {
          const pts = brushPoints.current;
          const last = pts[pts.length - 1];
          if (Math.hypot(e.nx - last[0], e.ny - last[1]) > 0.008) {
            pts.push([e.nx, e.ny]);
            setDraft({ type: "brush", points: [...pts], r: s.brushRadius });
          }
        } else if (tool === "annotate") {
          setDraftAnn({
            x: Math.min(start.nx, e.nx),
            y: Math.min(start.ny, e.ny),
            w: Math.abs(e.nx - start.nx),
            h: Math.abs(e.ny - start.ny),
          });
        }
        return;
      }

      if (e.kind === "up") {
        dragStart.current = null;
        if (tool === "annotate") {
          const moved = Math.hypot(e.nx - start.nx, e.ny - start.ny) > 0.01;
          setPending({
            domain: "spectrum",
            shape: moved
              ? { type: "rect", x: Math.min(start.nx, e.nx), y: Math.min(start.ny, e.ny), w: Math.abs(e.nx - start.nx), h: Math.abs(e.ny - start.ny) }
              : { type: "rect", x: start.nx, y: start.ny, w: 0, h: 0 },
          });
          setDraftAnn(null);
          return;
        }
        if (draft) {
          const tooSmall =
            (draft.type === "rect" && (draft.w < 0.004 || draft.h < 0.004)) ||
            (draft.type === "ellipse" && (draft.rx < 0.002 || draft.ry < 0.002)) ||
            (draft.type === "annulus" && draft.r_outer - draft.r_inner < 0.004);
          if (!tooSmall) s.addSelection(draft);
          setDraft(null);
        }
        brushPoints.current = [];
      }
    },
    [s, draft],
  );

  const imagePointer = useCallback(
    (e: PanelPointer) => {
      if (e.kind === "leave") {
        s.set({ hover: null });
        return;
      }
      s.set({
        hover: {
          panel: "image",
          nx: e.nx,
          ny: e.ny,
          fx: 0,
          fy: 0,
          cyclesPerPx: 0,
          wavelengthPx: null,
          orientationDeg: 0,
        },
      });
      const tool = s.tool;
      if (tool === "annotate") {
        if (e.kind === "down") dragStart.current = { nx: e.nx, ny: e.ny };
        else if (e.kind === "move" && e.buttons & 1 && dragStart.current) {
          const st = dragStart.current;
          setDraftAnn({
            x: Math.min(st.nx, e.nx),
            y: Math.min(st.ny, e.ny),
            w: Math.abs(e.nx - st.nx),
            h: Math.abs(e.ny - st.ny),
          });
        } else if (e.kind === "up" && dragStart.current) {
          const st = dragStart.current;
          dragStart.current = null;
          const moved = Math.hypot(e.nx - st.nx, e.ny - st.ny) > 0.01;
          setPending({
            domain: "image",
            shape: moved
              ? { type: "rect", x: Math.min(st.nx, e.nx), y: Math.min(st.ny, e.ny), w: Math.abs(e.nx - st.nx), h: Math.abs(e.ny - st.ny) }
              : { type: "rect", x: st.nx, y: st.ny, w: 0, h: 0 },
          });
          setDraftAnn(null);
        }
        return;
      }
      if (tool === "pan") return;

      // Every shape tool doubles as a spatial inspector on the image panel:
      // dragging (or clicking with the point tool) opens the local spectrum
      // of that region — the pixel→frequency direction.
      if (tool === "point") {
        if (e.kind === "down") {
          const half = 0.08; // ~16% of the image around the clicked pixel
          s.set({
            roiRect: {
              x: Math.max(0, e.nx - half),
              y: Math.max(0, e.ny - half),
              w: half * 2,
              h: half * 2,
            },
          });
        }
        return;
      }
      if (e.kind === "down") {
        dragStart.current = { nx: e.nx, ny: e.ny };
      } else if (e.kind === "move" && e.buttons & 1 && dragStart.current) {
        const st = dragStart.current;
        setDraftAnn({
          x: Math.min(st.nx, e.nx),
          y: Math.min(st.ny, e.ny),
          w: Math.abs(e.nx - st.nx),
          h: Math.abs(e.ny - st.ny),
        });
      } else if (e.kind === "up" && dragStart.current) {
        const st = dragStart.current;
        dragStart.current = null;
        setDraftAnn(null);
        const rect = {
          x: Math.max(0, Math.min(st.nx, e.nx)),
          y: Math.max(0, Math.min(st.ny, e.ny)),
          w: Math.abs(e.nx - st.nx),
          h: Math.abs(e.ny - st.ny),
        };
        if (rect.w > 0.01 && rect.h > 0.01) s.set({ roiRect: rect });
      }
    },
    [s],
  );

  // ------------------------------------------------------------------ vector layers

  const drawSpectrumExtras = useCallback(
    (ctx: CanvasRenderingContext2D, map: (nx: number, ny: number) => [number, number], scale: number) => {
      s.selections.forEach((spec) => drawSpec(ctx, map, spec));
      if (draft) drawSpec(ctx, map, draft);
      if (showMarkers) drawAnomalyMarkers(ctx, map, s.anomalies);
      s.annotations.filter((a) => a.domain === "spectrum").forEach((a) => drawAnnotation(ctx, map, a, scale));
      if (draftAnn && (s.tool === "annotate" || s.tool === "roi")) {
        const [x0, y0] = map(draftAnn.x, draftAnn.y);
        const [x1, y1] = map(draftAnn.x + draftAnn.w, draftAnn.y + draftAnn.h);
        ctx.strokeStyle = ACCENT;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]);
      }
      if (s.hover?.panel === "spectrum") drawCrosshair(ctx, map, s.hover.nx, s.hover.ny);
    },
    [s.selections, s.annotations, s.anomalies, s.hover, s.tool, draft, draftAnn, showMarkers],
  );

  const drawImageExtras = useCallback(
    (ctx: CanvasRenderingContext2D, map: (nx: number, ny: number) => [number, number], scale: number) => {
      s.annotations.filter((a) => a.domain === "image").forEach((a) => drawAnnotation(ctx, map, a, scale));
      if (s.roiRect) {
        const [x0, y0] = map(s.roiRect.x, s.roiRect.y);
        const [x1, y1] = map(s.roiRect.x + s.roiRect.w, s.roiRect.y + s.roiRect.h);
        ctx.strokeStyle = "#4ade80";
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]);
      }
      if (draftAnn && s.tool !== "pan") {
        const [x0, y0] = map(draftAnn.x, draftAnn.y);
        const [x1, y1] = map(draftAnn.x + draftAnn.w, draftAnn.y + draftAnn.h);
        ctx.strokeStyle = s.tool === "annotate" ? ACCENT : "#4ade80";
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]);
      }
    },
    [s.annotations, s.roiRect, s.tool, draftAnn],
  );

  // ------------------------------------------------------------------ session & export

  const saveSession = () => {
    const session = s.sessionObject();
    if (!session) return;
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${session.image.filename}.fourierlens.json`);
  };

  const loadSession = async (file: File) => {
    try {
      const session = JSON.parse(await file.text());
      if (session.app !== "fourierlens") throw new Error("Not a FourierLens session file");
      if (!s.meta && session.image.path) {
        await loadVia(api.loadFromPath(session.image.path));
      }
      const meta = useExplore.getState().meta;
      if (meta && meta.sha256 !== session.image.sha256) {
        if (!window.confirm(`Session was saved for "${session.image.filename}" (different content hash). Apply anyway?`)) return;
      }
      useExplore.getState().applySession(session);
    } catch (e) {
      s.set({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const exportAnnotatedPng = async (which: "image" | "spectrum") => {
    const base = which === "image" ? pixelBitmap : spectrumBitmap;
    if (!base || !s.meta) return;
    const canvas = document.createElement("canvas");
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    const map = (nx: number, ny: number): [number, number] => [nx * base.width, ny * base.height];
    if (which === "image" && overlayBitmap && s.pixelView === "overlay") {
      ctx.globalAlpha = s.overlayOpacity;
      ctx.drawImage(overlayBitmap, 0, 0, base.width, base.height);
      ctx.globalAlpha = 1;
    }
    if (which === "spectrum") {
      s.selections.forEach((spec) => drawSpec(ctx, map, spec));
      if (showMarkers) drawAnomalyMarkers(ctx, map, s.anomalies);
    }
    s.annotations.filter((a) => a.domain === which).forEach((a) => drawAnnotation(ctx, map, a, 1));
    canvas.toBlob((blob) => blob && downloadBlob(blob, `${s.meta!.filename}.${which}.annotated.png`));
  };

  const locateAnomaly = (flag: AnomalyFlag) => {
    const points: MaskSpec[] = flag.locations.map(({ x, y }) => ({ type: "point", x, y, r: s.pointRadius }));
    s.set({ selections: points, invert: false, pixelView: "overlay" });
  };

  // ------------------------------------------------------------------ render

  const pixelPanelBitmap =
    s.pixelView === "progressive" && progressiveBitmap ? progressiveBitmap : pixelBitmap;

  return (
    <div className="explore">
      <HeaderBar
        samples={samples}
        busy={busy}
        onSample={(name) => void loadVia(api.loadSample(name))}
        onUpload={onUploadFile}
        onSaveSession={saveSession}
        onLoadSession={loadSession}
        onExportPng={exportAnnotatedPng}
      />
      {s.error && (
        <div className="error-banner" onClick={() => s.set({ error: null })}>
          ⚠ {s.error} <span className="muted">(click to dismiss)</span>
        </div>
      )}
      {!s.imageId ? (
        <Welcome samples={samples} onSample={(n) => void loadVia(api.loadSample(n))} onUpload={onUploadFile} />
      ) : (
        <>
          <Toolbar />
          <ToolHintBar />
          <PreprocessControls ops={preprocessOps} />
          <SpectrumControls windowDescriptions={windowDescriptions} />
          <OverlayControls />
          <div className="panels">
            <section className="panel">
              <header>
                <b>Pixels</b>
                <span className="muted">
                  {s.pixelView === "overlay" && hasSelection && "band energy overlay"}
                  {s.pixelView === "filtered" && hasSelection && "◀ filtered | original ▶"}
                  {s.pixelView === "progressive" && `rebuilt from ${Math.round(s.progressiveFraction * 100)}% of frequencies`}
                </span>
              </header>
              <CanvasPanel
                bitmap={pixelPanelBitmap}
                overlay={s.pixelView === "overlay" ? overlayBitmap : null}
                overlayOpacity={s.overlayOpacity}
                compare={
                  s.pixelView === "filtered" && filteredBitmap
                    ? { bitmap: filteredBitmap, divider: s.compareSlider }
                    : null
                }
                drawExtras={drawImageExtras}
                onPointer={imagePointer}
                panWithLeft={s.tool === "pan"}
                cursor="crosshair"
                shared={sharedView}
                primary
                fitId={s.imageId ?? ""}
              />
            </section>
            <section className="panel">
              <header>
                <b>Frequency spectrum</b>
                <label className="check small" title="Show anomaly detector markers">
                  <input type="checkbox" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} />
                  ⚠ marks
                </label>
              </header>
              <CanvasPanel
                bitmap={spectrumBitmap}
                drawExtras={drawSpectrumExtras}
                onPointer={spectrumPointer}
                panWithLeft={s.tool === "pan"}
                shared={sharedView}
                fitId={s.imageId ?? ""}
              />
              {patchBitmap && (
                <div className="patch-card">
                  <header>
                    local spectrum of region
                    <button onClick={() => s.set({ roiRect: null })}>✕</button>
                  </header>
                  <PatchView bitmap={patchBitmap} colormap={s.spectrumColormap} />
                </div>
              )}
            </section>
            <aside className="sidebar">
              <nav>
                {(["anomalies", "metrics", "annotations", "selections"] as const).map((tab) => (
                  <button key={tab} className={sidebarTab === tab ? "active" : ""} onClick={() => setSidebarTab(tab)}>
                    {tab}
                    {tab === "anomalies" && s.anomalies.length > 0 && <span className="badge">{s.anomalies.length}</span>}
                    {tab === "annotations" && s.annotations.length > 0 && <span className="badge">{s.annotations.length}</span>}
                  </button>
                ))}
              </nav>
              <div className="sidebar-body">
                {sidebarTab === "metrics" && <MetricsTab metrics={s.metrics} />}
                {sidebarTab === "anomalies" && <AnomaliesTab flags={s.anomalies} onLocate={locateAnomaly} />}
                {sidebarTab === "annotations" && <AnnotationsTab />}
                {sidebarTab === "selections" && <SelectionsTab />}
              </div>
            </aside>
          </div>
          <StatusBar />
        </>
      )}
      {pending && (
        <AnnotationDialog
          onCancel={() => setPending(null)}
          onSave={(name, comment, color) => {
            s.addAnnotation({ domain: pending.domain, shape: pending.shape, name, comment, color });
            setPending(null);
            setSidebarTab("annotations");
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function HeaderBar({ samples, busy, onSample, onUpload, onSaveSession, onLoadSession, onExportPng }: {
  samples: { name: string }[];
  busy: boolean;
  onSample: (name: string) => void;
  onUpload: (f: File) => void;
  onSaveSession: () => void;
  onLoadSession: (f: File) => void;
  onExportPng: (which: "image" | "spectrum") => void;
}) {
  const { meta } = useExplore();
  return (
    <div className="header-bar">
      <label className="btn">
        📂 open image
        <input type="file" accept="image/*,.tif,.tiff" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
      </label>
      <select value="" onChange={(e) => e.target.value && onSample(e.target.value)} title="Bundled teaching samples">
        <option value="">samples…</option>
        {samples.map((s) => (
          <option key={s.name} value={s.name}>{s.name}</option>
        ))}
      </select>
      {busy && <span className="muted">loading…</span>}
      {meta && (
        <span className="meta-chip" title={`sha256 ${meta.sha256}`}>
          {meta.filename} · {meta.width}×{meta.height} · {meta.format} {meta.bit_depth}-bit
          {meta.n_channels === 1 ? " · gray" : ""}
          {meta.downscaled_for_analysis && (
            <em
              className="warn"
              title="Large images are analyzed on a downscaled copy so the explorer stays interactive. Use the CLI (fourierlens analyze / batch) for full-resolution numbers."
            >
              {" "}
              · analyzed at {meta.analysis_width}×{meta.analysis_height}
            </em>
          )}
        </span>
      )}
      <span className="spacer" />
      {meta && (
        <>
          <button className="btn" onClick={() => onExportPng("image")} title="Download the image with overlay + annotations">⬇ image PNG</button>
          <button className="btn" onClick={() => onExportPng("spectrum")} title="Download the spectrum with selections + annotations">⬇ spectrum PNG</button>
          <button className="btn" onClick={onSaveSession} title="Save selections, annotations and settings to a shareable JSON file">💾 session</button>
        </>
      )}
      <label className="btn" title="Load a saved session JSON">
        📥 load session
        <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && onLoadSession(e.target.files[0])} />
      </label>
    </div>
  );
}

function Welcome({ samples, onSample, onUpload }: {
  samples: { name: string }[];
  onSample: (n: string) => void;
  onUpload: (f: File) => void;
}) {
  return (
    <div className="welcome">
      <h1>FourierLens</h1>
      <p>
        Drop an image anywhere, paste from the clipboard, or pick a teaching sample.
        Everything is computed locally — nothing leaves your machine.
      </p>
      <label className="btn big">
        📂 Open an image
        <input type="file" accept="image/*,.tif,.tiff" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
      </label>
      <div className="sample-grid">
        {samples.map((s) => (
          <button key={s.name} onClick={() => onSample(s.name)}>{s.name.replace(/_/g, " ")}</button>
        ))}
      </div>
      <p className="muted small">
        Try <b>periodic_noise</b> to see anomaly flagging, or <b>grating</b> to learn how one
        frequency looks in the spectrum.
      </p>
    </div>
  );
}

function StatusBar() {
  const { hover, meta } = useExplore();
  return (
    <div className="status-bar">
      {hover?.panel === "spectrum" ? (
        <>
          <span>f = ({hover.fx.toFixed(3)}, {hover.fy.toFixed(3)}) Nyq</span>
          <span>{hover.cyclesPerPx.toFixed(4)} cycles/px</span>
          <span>λ = {hover.wavelengthPx ? `${hover.wavelengthPx.toFixed(1)} px` : "∞ (DC)"}</span>
          <span>θ = {hover.orientationDeg.toFixed(1)}°</span>
        </>
      ) : hover?.panel === "image" && meta ? (
        <span>
          pixel ({Math.round(hover.nx * meta.width)}, {Math.round(hover.ny * meta.height)})
        </span>
      ) : (
        <span className="muted">
          hover the spectrum for frequency info · keys: 1-9 tools · V view cycle · [ ] opacity · Ctrl+Z undo selection
        </span>
      )}
      <span className="spacer" />
      <GratingPreview hover={hover} />
    </div>
  );
}

function PatchView({ bitmap, colormap }: { bitmap: ImageBitmap; colormap: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    applyColormap(bitmap, colormap).then((bm) => {
      if (!live || !ref.current) return;
      const ctx = ref.current.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 200, 200);
      ctx.drawImage(bm, 0, 0, 200, 200);
    });
    return () => {
      live = false;
    };
  }, [bitmap, colormap]);
  return <canvas ref={ref} width={200} height={200} />;
}

function AnnotationDialog({ onSave, onCancel }: {
  onSave: (name: string, comment: string, color: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [color, setColor] = useState("#f472b6");
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New annotation</h3>
        <input autoFocus placeholder="name (e.g. 'moiré peak', 'sensor banding')" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea placeholder="comment for your colleagues…" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="color-row">
          {["#f472b6", "#fb923c", "#facc15", "#4ade80", "#7dd3fc", "#c084fc"].map((c) => (
            <button key={c} className={`swatch ${color === c ? "active" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>cancel</button>
          <button className="btn primary" onClick={() => onSave(name || "note", comment, color)}>save</button>
        </div>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
