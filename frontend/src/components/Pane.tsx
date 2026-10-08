import { useCallback, useEffect, useRef, useState } from "react";
import type { Space } from "../api";
import { drawAnnotation } from "../annotations";
import { useApp, type Annotation } from "../store";
import { hover, viewports } from "../viewport";

interface Props {
  url: string | null;
  space: Space;
  /** "original" for the photo, otherwise the view id (used by the readout) */
  viewId: string;
  title: string;
  editable: boolean;
}

type Draft = Omit<Annotation, "id">;

const SCREEN_STYLE = { lineWidth: 2.5, fontPx: 13 };
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 400;

let spaceHeld = false;
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
    spaceHeld = true;
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") spaceHeld = false;
});

/** Zoomable, pannable image with annotations and a shared crosshair. */
export default function Pane({ url, space, viewId, title, editable }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const rafRef = useRef(0);
  const sizedRef = useRef(false); // canvas sized by the ResizeObserver yet?
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [noteAt, setNoteAt] = useState<{ x: number; y: number; sx: number; sy: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const tool = useApp((s) => s.tool);
  const color = useApp((s) => s.color);
  const annotations = useApp((s) => s.annotations);
  const crosshair = useApp((s) => s.crosshair);
  const addAnnotation = useApp((s) => s.addAnnotation);
  const vp = viewports[space];

  const latest = useRef({ annotations, crosshair });
  latest.current = { annotations, crosshair };

  const geom = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return null;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    if (!cw || !ch) return null;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const fit = Math.min(cw / iw, ch / ih) * 0.96;
    if (vp.pendingFocus && sizedRef.current) {
      const r = vp.pendingFocus;
      vp.pendingFocus = null;
      vp.zoom = clamp(Math.min(cw / (r.w * 1.8), ch / (r.h * 1.8)) / fit, 1, MAX_ZOOM);
      vp.cx = r.x + r.w / 2;
      vp.cy = r.y + r.h / 2;
      requestAnimationFrame(() => vp.notify());
    }
    if (vp.pendingActual && sizedRef.current) {
      vp.pendingActual = false;
      vp.zoom = clamp(1 / fit, MIN_ZOOM, MAX_ZOOM);
      requestAnimationFrame(() => vp.notify());
    }
    const scale = fit * vp.zoom;
    const cx = vp.cx ?? iw / 2;
    const cy = vp.cy ?? ih / 2;
    return { dpr, cw, ch, iw, ih, fit, scale, cx, cy, ox: cw / 2 - cx * scale, oy: ch / 2 - cy * scale };
  }, [vp]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const g = geom();
    const img = imgRef.current;
    if (!g || !img) return;
    // pixel-exact when zoomed in, so individual pixels can be inspected
    ctx.imageSmoothingEnabled = g.scale < 3;
    ctx.drawImage(img, g.ox, g.oy, g.iw * g.scale, g.ih * g.scale);
    const map = (x: number, y: number): [number, number] => [g.ox + x * g.scale, g.oy + y * g.scale];
    for (const a of latest.current.annotations) if (a.space === space) drawAnnotation(ctx, { ...a, id: "" }, map, SCREEN_STYLE);
    if (draftRef.current) drawAnnotation(ctx, { ...draftRef.current, id: "" }, map, SCREEN_STYLE);

    const h = hover.state;
    if (latest.current.crosshair && h && h.space === space) {
      const [sx, sy] = map(h.x + 0.5, h.y + 0.5);
      ctx.save();
      for (const [w, c] of [[3, "rgba(0,0,0,0.65)"], [1, "#7dd3fc"]] as const) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(g.cw, sy);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, g.ch);
        ctx.stroke();
      }
      ctx.strokeStyle = "#7dd3fc";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx - 7, sy - 7, 14, 14);
      ctx.restore();
    }
  }, [geom, space]);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);

  // load the image; keep showing the previous one until the new one is ready
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const img = new Image();
    img.src = url;
    img
      .decode()
      .then(() => {
        if (cancelled) return;
        imgRef.current = img;
        setLoading(false);
        schedule();
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, schedule]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      sizedRef.current = r.width > 0 && r.height > 0;
      draw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => vp.subscribe(schedule), [vp, schedule]);
  useEffect(() => hover.subscribe(() => latest.current.crosshair && schedule()), [schedule]);
  useEffect(schedule, [annotations, crosshair, schedule]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const toImage = (e: { clientX: number; clientY: number }) => {
    const g = geom();
    const canvas = canvasRef.current;
    if (!g || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { g, sx, sy, x: (sx - g.ox) / g.scale, y: (sy - g.oy) / g.scale };
  };

  // wheel zoom around the cursor (non-passive so the page doesn't scroll)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toImage(e);
      if (!p) return;
      const zoom = clamp(vp.zoom * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
      const scale = p.g.fit * zoom;
      vp.zoom = zoom;
      vp.cx = p.x - (p.sx - p.g.cw / 2) / scale;
      vp.cy = p.y - (p.sy - p.g.ch / 2) / scale;
      vp.notify();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  });

  const drawing = editable && tool !== "move";

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toImage(e);
    if (!p || noteAt) return;
    if (!drawing || e.button === 1 || spaceHeld) {
      dragRef.current = { sx: e.clientX, sy: e.clientY, cx: p.g.cx, cy: p.g.cy };
      setPanning(true);
    } else if (e.button === 0 && tool === "text") {
      e.preventDefault(); // otherwise the follow-up mousedown steals focus from the note box
      setNoteAt({ x: p.x, y: p.y, sx: p.sx, sy: p.sy });
      return;
    } else if (e.button === 0) {
      const pt: [number, number] = [p.x, p.y];
      draftRef.current = { kind: tool as Draft["kind"], space, color, text: "", points: tool === "pen" ? [pt] : [pt, pt] };
    }
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toImage(e);
    if (!p) return;
    const inside = p.x >= 0 && p.y >= 0 && p.x < p.g.iw && p.y < p.g.ih;
    hover.set(inside ? { x: Math.floor(p.x), y: Math.floor(p.y), space, view: viewId, width: p.g.iw, height: p.g.ih } : null);
    const drag = dragRef.current;
    if (drag) {
      vp.cx = drag.cx - (e.clientX - drag.sx) / p.g.scale;
      vp.cy = drag.cy - (e.clientY - drag.sy) / p.g.scale;
      vp.notify();
      return;
    }
    const d = draftRef.current;
    if (d) {
      const pt: [number, number] = [p.x, p.y];
      if (d.kind === "pen") {
        const last = d.points[d.points.length - 1];
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) * p.g.scale > 2) d.points.push(pt);
      } else {
        d.points[1] = pt;
      }
      schedule();
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
    setPanning(false);
    const d = draftRef.current;
    draftRef.current = null;
    if (!d) return;
    const g = geom();
    const [a, b] = [d.points[0], d.points[d.points.length - 1]];
    const big = g ? Math.hypot(b[0] - a[0], b[1] - a[1]) * g.scale > 6 : false;
    if ((d.kind === "pen" && d.points.length > 2) || big) addAnnotation(d);
    else schedule();
  };

  const commitNote = (text: string) => {
    if (noteAt && text.trim()) addAnnotation({ kind: "text", space, color, text: text.trim(), points: [[noteAt.x, noteAt.y]] });
    setNoteAt(null);
  };

  const cursor = panning ? "grabbing" : drawing ? (tool === "text" ? "text" : "crosshair") : "grab";

  return (
    <div className="pane" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => hover.set(null)}
        onDoubleClick={() => !drawing && vp.reset()}
      />
      <div className="pane-title">{title}</div>
      {loading && <div className="pane-status"><span className="spinner" /> Computing…</div>}
      {failed && <div className="pane-status error">Could not load this view. Open the image again.</div>}
      {noteAt && (
        <input
          className="note-input"
          style={{ left: noteAt.sx, top: noteAt.sy }}
          autoFocus
          placeholder="Type a note, press Enter"
          onKeyDown={(e) => {
            if (e.key === "Enter") commitNote(e.currentTarget.value);
            if (e.key === "Escape") setNoteAt(null);
            e.stopPropagation();
          }}
          onBlur={(e) => commitNote(e.currentTarget.value)}
        />
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
