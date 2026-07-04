import { useEffect, useRef } from "react";
import type { HoverInfo } from "../types";

/** Tiny live rendering of the sinusoidal grating a hovered spectrum point
 * represents — the single most effective way to teach what "a point in the
 * spectrum" means. */
export default function GratingPreview({ hover, size = 84 }: { hover: HoverInfo | null; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    if (!hover || hover.panel !== "spectrum") {
      ctx.clearRect(0, 0, size, size);
      return;
    }
    // one canvas pixel = one image pixel; frequency in cycles/px
    const fx = hover.fx * 0.5;
    const fy = hover.fy * 0.5;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = Math.round(127.5 + 127.5 * Math.cos(2 * Math.PI * (fx * x + fy * y)));
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hover, size]);

  return (
    <div className="grating-preview" title="The sinusoidal pattern this spectrum point contributes to the image">
      <canvas ref={ref} width={size} height={size} />
      <span className="grating-caption">grating</span>
    </div>
  );
}
