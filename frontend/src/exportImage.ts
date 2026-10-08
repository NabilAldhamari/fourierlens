// Annotated PNG downloads, rendered at the analysis resolution.

import type { Space } from "./api";
import { FONT_FAMILY, drawAnnotation, exportStyle } from "./annotations";
import type { Annotation } from "./store";
import { decodeImage } from "./viewport";

function drawLayer(ctx: CanvasRenderingContext2D, img: HTMLImageElement, anns: Annotation[], space: Space, ox = 0, oy = 0) {
  ctx.drawImage(img, ox, oy);
  const style = exportStyle(img.naturalWidth, img.naturalHeight);
  for (const a of anns) if (a.space === space) drawAnnotation(ctx, a, (x, y) => [x + ox, y + oy], style);
}

function save(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
}

export interface Layer {
  url: string;
  space: Space;
  title: string;
}

/** One image with its notes. */
export async function downloadSingle(layer: Layer, anns: Annotation[], filename: string) {
  const img = await decodeImage(layer.url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  drawLayer(canvas.getContext("2d")!, img, anns, layer.space);
  save(canvas, filename);
}

/** Two images next to each other with a caption bar, for papers and reports. */
export async function downloadSideBySide(left: Layer, right: Layer, anns: Annotation[], caption: string, filename: string) {
  const [a, b] = await Promise.all([decodeImage(left.url), decodeImage(right.url)]);
  const gap = Math.max(8, Math.round(a.naturalWidth / 100));
  const font = Math.max(16, Math.round(Math.max(a.naturalWidth, a.naturalHeight) / 42));
  const bar = Math.round(font * 2.2);
  const canvas = document.createElement("canvas");
  canvas.width = a.naturalWidth + gap + b.naturalWidth;
  canvas.height = bar + Math.max(a.naturalHeight, b.naturalHeight) + Math.round(font * 1.8);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0e1117";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e8ecf3";
  ctx.font = `600 ${font}px ${FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  ctx.fillText(left.title, 0, bar / 2);
  ctx.fillText(right.title, a.naturalWidth + gap, bar / 2);
  drawLayer(ctx, a, anns, left.space, 0, bar);
  drawLayer(ctx, b, anns, right.space, a.naturalWidth + gap, bar);
  ctx.fillStyle = "#8a93a6";
  ctx.font = `${Math.round(font * 0.7)}px ${FONT_FAMILY}`;
  ctx.fillText(caption, 0, canvas.height - font * 0.9);
  save(canvas, filename);
}
