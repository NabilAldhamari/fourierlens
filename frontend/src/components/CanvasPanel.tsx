import { useCallback, useEffect, useRef } from "react";

export interface PanelPointer {
  nx: number; // normalized [0,1] in bitmap space (may exceed range mid-drag)
  ny: number;
  kind: "down" | "move" | "up" | "leave";
  buttons: number;
  shiftKey: boolean;
}

export interface ViewTransform {
  zoom: number;
  ox: number;
  oy: number;
}

/** Mutable view transform shared by multiple panels: zooming/panning one panel
 * moves all subscribers. Lives outside React state on purpose - pan events fire
 * per mousemove and must not trigger re-renders. */
export interface SharedView {
  v: ViewTransform;
  fitKey: string;
  subscribe(fn: () => void): () => void;
  notify(): void;
}

export function createSharedView(): SharedView {
  const listeners = new Set<() => void>();
  return {
    v: { zoom: 1, ox: 0, oy: 0 },
    fitKey: "",
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    notify() {
      listeners.forEach((fn) => fn());
    },
  };
}

interface Props {
  bitmap: ImageBitmap | null;
  /** colorized energy overlay drawn on top of the bitmap */
  overlay?: ImageBitmap | null;
  overlayOpacity?: number;
  /** second full-frame bitmap revealed left of the divider (before/after mode) */
  compare?: { bitmap: ImageBitmap; divider: number } | null;
  /** vector layer: selections, annotations, markers. map() converts normalized
   * bitmap coords to device-canvas coords; scale is device px per bitmap px. */
  drawExtras?: (
    ctx: CanvasRenderingContext2D,
    map: (nx: number, ny: number) => [number, number],
    scale: number,
  ) => void;
  onPointer?: (e: PanelPointer) => void;
  /** left-drag pans when true (pan tool); middle-drag always pans */
  panWithLeft?: boolean;
  cursor?: string;
  /** bump to re-render the vector layer without other prop changes */
  extrasKey?: unknown;
  /** link this panel's zoom/pan to other panels sharing the same object */
  shared?: SharedView;
  /** with a shared view, exactly ONE panel must be primary: it owns the
   * fit-to-view calculation. Secondary panels only read the shared transform,
   * so the two panels never fight over slightly different pixel sizes. */
  primary?: boolean;
  /** identity of the loaded content (e.g. image id). Auto-fit runs only when
   * this or the bitmap dimensions change — NOT when the panel resizes, so
   * layout shifts (hint bar growing, sidebar toggling, tool switches) never
   * reset the user's zoom. */
  fitId?: string;
}

/** Zoomable/pannable canvas used by both the pixel and spectrum panels. */
export default function CanvasPanel({
  bitmap,
  overlay,
  overlayOpacity = 0.6,
  compare,
  drawExtras,
  onPointer,
  panWithLeft = false,
  cursor = "crosshair",
  extrasKey,
  shared,
  primary = false,
  fitId = "",
}: Props) {
  // the panel that owns the fit: the primary when linked, else always (unlinked)
  const ownsFit = !shared || primary;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const localView = useRef<ViewTransform>({ zoom: 1, ox: 0, oy: 0 });
  const localFit = useRef<string>("");
  const dragging = useRef<{ mode: "pan" | "tool"; lastX: number; lastY: number } | null>(null);

  const getView = useCallback((): ViewTransform => (shared ? shared.v : localView.current), [shared]);
  const setView = useCallback(
    (v: ViewTransform) => {
      if (shared) {
        shared.v = v;
        shared.notify(); // redraws every linked panel, including this one
      } else {
        localView.current = v;
      }
    },
    [shared],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth * dpr;
    const ch = wrap.clientHeight * dpr;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#07090d";
    ctx.fillRect(0, 0, cw, ch);
    if (!bitmap) {
      return;
    }

    // Only the fit-owner (re)computes the transform, keyed on the CONTENT
    // identity (fitId + bitmap dims) — never on the panel's pixel size.
    // Panel resizes (hint bar growing, tool switches, window resizes) keep the
    // user's zoom/pan; only loading different content refits.
    if (ownsFit && cw > 50 && ch > 50) {
      const fitKey = `${fitId}:${bitmap.width}x${bitmap.height}`;
      const currentKey = shared ? shared.fitKey : localFit.current;
      if (currentKey !== fitKey) {
        if (shared) shared.fitKey = fitKey;
        else localFit.current = fitKey;
        const s = Math.min(cw / bitmap.width, ch / bitmap.height) * 0.96;
        setView({
          zoom: s,
          ox: (cw - bitmap.width * s) / 2,
          oy: (ch - bitmap.height * s) / 2,
        });
      }
    }
    const { zoom, ox, oy } = getView();
    const w = bitmap.width * zoom;
    const h = bitmap.height * zoom;
    ctx.imageSmoothingEnabled = zoom < 3;
    ctx.drawImage(bitmap, ox, oy, w, h);

    if (compare) {
      const divider = Math.max(0, Math.min(1, compare.divider));
      const splitX = ox + w * divider;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, w * divider, h);
      ctx.clip();
      ctx.drawImage(compare.bitmap, ox, oy, w, h);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(splitX, oy);
      ctx.lineTo(splitX, oy + h);
      ctx.stroke();
    }

    if (overlay) {
      ctx.globalAlpha = overlayOpacity;
      ctx.drawImage(overlay, ox, oy, w, h);
      ctx.globalAlpha = 1;
    }

    if (drawExtras) {
      const map = (nx: number, ny: number): [number, number] => [ox + nx * w, oy + ny * h];
      drawExtras(ctx, map, zoom);
    }
  }, [bitmap, overlay, overlayOpacity, compare, drawExtras, extrasKey, shared, ownsFit, fitId, getView, setView]);

  useEffect(() => {
    draw();
  }, [draw]);

  // linked panels redraw when any of them changes the shared transform
  useEffect(() => {
    if (!shared) return;
    return shared.subscribe(draw);
  }, [shared, draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const obs = new ResizeObserver(() => draw());
    obs.observe(wrap);
    return () => obs.disconnect();
  }, [draw]);

  const toNorm = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cx = (clientX - rect.left) * dpr;
      const cy = (clientY - rect.top) * dpr;
      const { zoom, ox, oy } = getView();
      const bw = bitmap?.width ?? 1;
      const bh = bitmap?.height ?? 1;
      return [(cx - ox) / (bw * zoom), (cy - oy) / (bh * zoom)];
    },
    [bitmap, getView],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!bitmap) return;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cx = (e.clientX - rect.left) * dpr;
      const cy = (e.clientY - rect.top) * dpr;
      const v = getView();
      const newZoom = Math.max(0.05, Math.min(200, v.zoom * factor));
      const k = newZoom / v.zoom;
      setView({ zoom: newZoom, ox: cx - (cx - v.ox) * k, oy: cy - (cy - v.oy) * k });
      if (!shared) draw();
    },
    [bitmap, draw, getView, setView, shared],
  );

  const pointerNorm = (e: React.PointerEvent, kind: PanelPointer["kind"]) => {
    const [nx, ny] = toNorm(e.clientX, e.clientY);
    onPointer?.({ nx, ny, kind, buttons: e.buttons, shiftKey: e.shiftKey });
  };

  const handleDown = (e: React.PointerEvent) => {
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    const pan = e.button === 1 || (e.button === 0 && panWithLeft);
    dragging.current = { mode: pan ? "pan" : "tool", lastX: e.clientX, lastY: e.clientY };
    if (!pan && e.button === 0) pointerNorm(e, "down");
  };

  const handleMove = (e: React.PointerEvent) => {
    const drag = dragging.current;
    if (drag?.mode === "pan") {
      const dpr = window.devicePixelRatio || 1;
      const v = getView();
      setView({
        zoom: v.zoom,
        ox: v.ox + (e.clientX - drag.lastX) * dpr,
        oy: v.oy + (e.clientY - drag.lastY) * dpr,
      });
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (!shared) draw();
      return;
    }
    pointerNorm(e, "move");
  };

  const handleUp = (e: React.PointerEvent) => {
    const wasTool = dragging.current?.mode === "tool";
    dragging.current = null;
    if (wasTool) pointerNorm(e, "up");
  };

  return (
    <div ref={wrapRef} className="canvas-wrap" style={{ cursor: panWithLeft ? "grab" : cursor }}>
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={(e) => {
          if (!dragging.current) pointerNorm(e, "leave");
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
