/** Vector rendering of selections, annotations, and anomaly markers on the
 * canvas panels. All shapes use normalized [0,1] canvas coordinates; `map`
 * converts them to device pixels (see CanvasPanel.drawExtras).
 */

import type { Annotation, AnomalyFlag, MaskSpec } from "./types";

export const ACCENT = "#7dd3fc";
export const ACCENT_DIM = "rgba(125, 211, 252, 0.18)";
const CONJUGATE = "rgba(125, 211, 252, 0.55)";

type MapFn = (nx: number, ny: number) => [number, number];

/** Mirror a normalized canvas point through the spectrum center (conjugate). */
const mirror = (x: number, y: number): [number, number] => [1 - x, 1 - y];

function freqRadiusToDevice(map: MapFn, r: number): [number, number] {
  // frequency radius r (1 = Nyquist) spans r/2 of the canvas per axis
  const [cx, cy] = map(0.5, 0.5);
  const [ex, ey] = map(0.5 + r / 2, 0.5 + r / 2);
  return [Math.abs(ex - cx), Math.abs(ey - cy)];
}

function strokeFill(ctx: CanvasRenderingContext2D, dashed = false) {
  ctx.fillStyle = ACCENT_DIM;
  ctx.strokeStyle = dashed ? CONJUGATE : ACCENT;
  ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawEllipseAt(ctx: CanvasRenderingContext2D, map: MapFn, cx: number, cy: number, rxDev: number, ryDev: number, dashed = false) {
  const [dx, dy] = map(cx, cy);
  ctx.beginPath();
  ctx.ellipse(dx, dy, Math.max(rxDev, 2), Math.max(ryDev, 2), 0, 0, Math.PI * 2);
  strokeFill(ctx, dashed);
}

export function drawSpec(ctx: CanvasRenderingContext2D, map: MapFn, spec: MaskSpec, withConjugate = true) {
  switch (spec.type) {
    case "rect": {
      const [x0, y0] = map(spec.x, spec.y);
      const [x1, y1] = map(spec.x + spec.w, spec.y + spec.h);
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      strokeFill(ctx);
      if (withConjugate) {
        const [mx, my] = mirror(spec.x + spec.w, spec.y + spec.h);
        const [mx1, my1] = mirror(spec.x, spec.y);
        const [a0, b0] = map(mx, my);
        const [a1, b1] = map(mx1, my1);
        ctx.beginPath();
        ctx.rect(a0, b0, a1 - a0, b1 - b0);
        strokeFill(ctx, true);
      }
      break;
    }
    case "ellipse": {
      const [rx] = freqRadiusToDevice(map, spec.rx * 2);
      const [, ry] = freqRadiusToDevice(map, spec.ry * 2);
      drawEllipseAt(ctx, map, spec.cx, spec.cy, rx, ry);
      if (withConjugate) {
        const [mx, my] = mirror(spec.cx, spec.cy);
        drawEllipseAt(ctx, map, mx, my, rx, ry, true);
      }
      break;
    }
    case "point": {
      const [rx, ry] = freqRadiusToDevice(map, spec.r);
      drawEllipseAt(ctx, map, spec.x, spec.y, rx, ry);
      if (withConjugate) {
        const [mx, my] = mirror(spec.x, spec.y);
        drawEllipseAt(ctx, map, mx, my, rx, ry, true);
      }
      break;
    }
    case "annulus": {
      const [cx, cy] = map(0.5, 0.5);
      const [rIn] = freqRadiusToDevice(map, spec.r_inner);
      const [rOut] = freqRadiusToDevice(map, spec.r_outer);
      const [, rInY] = freqRadiusToDevice(map, spec.r_inner);
      const [, rOutY] = freqRadiusToDevice(map, spec.r_outer);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rOut, rOutY, 0, 0, Math.PI * 2);
      ctx.ellipse(cx, cy, Math.max(rIn, 0.5), Math.max(rInY, 0.5), 0, 0, Math.PI * 2, true);
      strokeFill(ctx);
      break;
    }
    case "wedge": {
      const [cx, cy] = map(0.5, 0.5);
      const [rx] = freqRadiusToDevice(map, 1.6); // beyond corners
      const a = (spec.angle_deg * Math.PI) / 180;
      const halfW = (spec.width_deg * Math.PI) / 360;
      for (const base of [a, a + Math.PI]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rx, base - halfW, base + halfW);
        ctx.closePath();
        strokeFill(ctx, base !== a);
      }
      break;
    }
    case "brush": {
      if (spec.points.length === 0) break;
      const [rDev] = freqRadiusToDevice(map, spec.r);
      for (const conj of withConjugate ? [false, true] : [false]) {
        ctx.beginPath();
        spec.points.forEach(([px, py], i) => {
          const [mx, my] = conj ? mirror(px, py) : [px, py];
          const [dx, dy] = map(mx, my);
          if (i === 0) ctx.moveTo(dx, dy);
          else ctx.lineTo(dx, dy);
        });
        ctx.strokeStyle = conj ? CONJUGATE : "rgba(125, 211, 252, 0.5)";
        ctx.lineWidth = Math.max(rDev * 2, 3);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.lineWidth = 1.5;
      }
      break;
    }
  }
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, map: MapFn, a: Annotation, scale: number) {
  if (!a.visible) return;
  const [x0, y0] = map(a.shape.x, a.shape.y);
  const [x1, y1] = map(a.shape.x + a.shape.w, a.shape.y + a.shape.h);
  ctx.strokeStyle = a.color;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  const isPoint = a.shape.w < 1e-6 && a.shape.h < 1e-6;
  ctx.beginPath();
  if (isPoint) {
    ctx.arc(x0, y0, 6, 0, Math.PI * 2);
    ctx.moveTo(x0 - 10, y0);
    ctx.lineTo(x0 + 10, y0);
    ctx.moveTo(x0, y0 - 10);
    ctx.lineTo(x0, y0 + 10);
  } else if (a.shape.type === "ellipse") {
    ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  }
  ctx.stroke();

  // label chip
  const label = a.name || "note";
  ctx.font = "600 11px system-ui, sans-serif";
  const tw = ctx.measureText(label).width;
  const lx = isPoint ? x0 + 9 : x0;
  const ly = (isPoint ? y0 : y0) - 8;
  ctx.fillStyle = a.color;
  ctx.beginPath();
  ctx.roundRect(lx, ly - 12, tw + 10, 15, 3);
  ctx.fill();
  ctx.fillStyle = "#0b0e14";
  ctx.fillText(label, lx + 5, ly);
  void scale;
}

export function drawAnomalyMarkers(ctx: CanvasRenderingContext2D, map: MapFn, flags: AnomalyFlag[]) {
  ctx.setLineDash([]);
  flags.forEach((flag) => {
    flag.locations.forEach(({ x, y }) => {
      const [dx, dy] = map(x, y);
      ctx.strokeStyle = "#fb923c";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(dx, dy, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(dx - 13, dy);
      ctx.lineTo(dx - 5, dy);
      ctx.moveTo(dx + 5, dy);
      ctx.lineTo(dx + 13, dy);
      ctx.moveTo(dx, dy - 13);
      ctx.lineTo(dx, dy - 5);
      ctx.moveTo(dx, dy + 5);
      ctx.lineTo(dx, dy + 13);
      ctx.stroke();
    });
  });
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, map: MapFn, nx: number, ny: number) {
  const [dx, dy] = map(nx, ny);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  const [cx, cy] = map(0.5, 0.5);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(dx, dy);
  ctx.stroke();
  ctx.setLineDash([]);
}
