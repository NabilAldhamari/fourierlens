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
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef<ViewTransform>({ zoom: 1, ox: 0, oy: 0 });
  const fitted = useRef<string>("");
  const dragging = useRef<{ mode: "pan" | "tool"; lastX: number; lastY: number } | null>(null);

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

    // fit once per bitmap identity/panel size
    const fitKey = `${bitmap.width}x${bitmap.height}:${cw}x${ch}`;
    if (fitted.current !== fitKey) {
      fitted.current = fitKey;
      const s = Math.min(cw / bitmap.width, ch / bitmap.height) * 0.96;
      view.current = {
        zoom: s,
        ox: (cw - bitmap.width * s) / 2,
        oy: (ch - bitmap.height * s) / 2,
      };
    }
    const { zoom, ox, oy } = view.current;
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
  }, [bitmap, overlay, overlayOpacity, compare, drawExtras, extrasKey]);

  useEffect(() => {
    draw();
  }, [draw]);

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
      const { zoom, ox, oy } = view.current;
      const bw = bitmap?.width ?? 1;
      const bh = bitmap?.height ?? 1;
      return [(cx - ox) / (bw * zoom), (cy - oy) / (bh * zoom)];
    },
    [bitmap],
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
      const v = view.current;
      const newZoom = Math.max(0.05, Math.min(200, v.zoom * factor));
      const k = newZoom / v.zoom;
      view.current = { zoom: newZoom, ox: cx - (cx - v.ox) * k, oy: cy - (cy - v.oy) * k };
      draw();
    },
    [bitmap, draw],
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
      view.current.ox += (e.clientX - drag.lastX) * dpr;
      view.current.oy += (e.clientY - drag.lastY) * dpr;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      draw();
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
