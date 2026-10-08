// Drawing annotations: shared by the live panes and the PNG export, so what
// you see on screen is exactly what gets downloaded.

import type { Annotation, AnnotationDraft } from "./store";

export const FONT_FAMILY = `system-ui, -apple-system, "Segoe UI", sans-serif`;

export interface DrawStyle {
  lineWidth: number;
  fontPx: number;
}

type Map = (x: number, y: number) => [number, number];

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, style: DrawStyle) {
  if (!text) return;
  ctx.font = `600 ${style.fontPx}px ${FONT_FAMILY}`;
  const pad = style.fontPx * 0.35;
  const lines = text.split("\n");
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const lh = style.fontPx * 1.25;
  const h = lines.length * lh + pad * 1.2;
  ctx.fillStyle = "rgba(10, 12, 18, 0.82)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, pad);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.max(2, style.lineWidth), h);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, x + pad * 1.4, y + pad * 0.6 + i * lh));
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, a: AnnotationDraft, map: Map, style: DrawStyle) {
  const pts = a.points.map(([x, y]) => map(x, y));
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.lineWidth = style.lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = style.lineWidth * 1.5;
  const [p0, p1] = pts;
  if (a.kind === "rect" && p1) {
    ctx.strokeRect(Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.abs(p1[0] - p0[0]), Math.abs(p1[1] - p0[1]));
  } else if (a.kind === "ellipse" && p1) {
    ctx.beginPath();
    ctx.ellipse((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, Math.abs(p1[0] - p0[0]) / 2, Math.abs(p1[1] - p0[1]) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (a.kind === "arrow" && p1) {
    const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const head = style.lineWidth * 5;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.moveTo(p1[0] - head * Math.cos(ang - 0.45), p1[1] - head * Math.sin(ang - 0.45));
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p1[0] - head * Math.cos(ang + 0.45), p1[1] - head * Math.sin(ang + 0.45));
    ctx.stroke();
  } else if (a.kind === "pen" && pts.length > 1) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  if (a.text) {
    // notes sit at their point; shape labels sit just above the shape's top-left
    let lx = p0[0];
    let ly = p0[1];
    if (a.kind !== "text") {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      lx = Math.min(...xs);
      ly = Math.min(...ys) - style.fontPx * 1.7 - style.lineWidth;
    }
    label(ctx, a.text, lx, ly, a.color, style);
  } else if (a.kind === "text") {
    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.arc(p0[0], p0[1], style.lineWidth * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Line width and font size for drawing at an image's native resolution. */
export function exportStyle(width: number, height: number): DrawStyle {
  const long = Math.max(width, height);
  return { lineWidth: Math.max(2, Math.round(long / 350)), fontPx: Math.max(14, Math.round(long / 48)) };
}

export const SHAPE_NAMES: Record<Annotation["kind"], string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  arrow: "Arrow",
  pen: "Freehand",
  text: "Note",
};
