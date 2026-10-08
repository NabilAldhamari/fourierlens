// Shared zoom/pan and pointer state for the image panes.
//
// Panes that show the same coordinate space (the photo and every spatial view)
// share one viewport, so zooming one zooms the other. The frequency plane has
// its own. These live outside React on purpose: they change on every mouse
// move and must not re-render the tree.

import type { Region, Space } from "./api";

type Listener = () => void;

class Hub {
  private listeners = new Set<Listener>();
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  notify() {
    this.listeners.forEach((fn) => fn());
  }
}

export class Viewport extends Hub {
  /** magnification relative to "fit to pane" */
  zoom = 1;
  /** image-pixel coordinate at the pane centre; null = image centre */
  cx: number | null = null;
  cy: number | null = null;
  /** requests resolved by the next pane that draws (it knows its own size) */
  pendingFocus: Region | null = null;
  pendingActual = false;

  reset() {
    this.zoom = 1;
    this.cx = this.cy = null;
    this.pendingFocus = null;
    this.pendingActual = false;
    this.notify();
  }
  focus(region: Region) {
    this.pendingFocus = region;
    this.notify();
  }
  actualSize() {
    this.pendingActual = true;
    this.notify();
  }
}

export const viewports: Record<Space, Viewport> = { image: new Viewport(), spectrum: new Viewport() };

export function fitAllViewports() {
  viewports.image.reset();
  viewports.spectrum.reset();
}

export function actualSizeAllViewports() {
  viewports.image.actualSize();
  viewports.spectrum.actualSize();
}

export async function decodeImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export interface HoverState {
  x: number;
  y: number;
  space: Space;
  view: string; // view id of the pane under the pointer ("original" for the photo)
  width: number;
  height: number;
}

class HoverHub extends Hub {
  state: HoverState | null = null;
  set(s: HoverState | null) {
    this.state = s;
    this.notify();
  }
}

export const hover = new HoverHub();

/** Reads original-photo pixels for the readout without keeping a full copy in JS. */
class PixelSampler {
  private ctx: CanvasRenderingContext2D | null = null;
  private url = "";
  async load(url: string) {
    if (url === this.url) return;
    this.url = url;
    const img = await decodeImage(url);
    if (url !== this.url) return;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx?.drawImage(img, 0, 0);
    this.ctx = ctx;
  }
  sample(x: number, y: number): [number, number, number] | null {
    if (!this.ctx) return null;
    const d = this.ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    return [d[0], d[1], d[2]];
  }
}

export const pixels = new PixelSampler();
