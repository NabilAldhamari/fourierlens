import { useEffect, useState } from "react";
import { useApp } from "../store";
import { hover, pixels, type HoverState } from "../viewport";

/** Bottom bar: what is under the pointer. */
export default function StatusBar() {
  const image = useApp((s) => s.image);
  const [h, setH] = useState<HoverState | null>(null);

  useEffect(() => {
    let raf = 0;
    const unsub = hover.subscribe(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setH(hover.state && { ...hover.state });
      });
    });
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <footer className="statusbar">
      <span className="readout">{h ? readout(h) : image ? "Scroll to zoom · drag to pan · double-click to fit" : ""}</span>
      <span className="spacer" />
      {image && (
        <span className="muted">
          {image.meta.analysis_width} × {image.meta.analysis_height} px
        </span>
      )}
    </footer>
  );
}

function readout(h: HoverState): string {
  if (h.space === "image") {
    const rgb = pixels.sample(h.x, h.y);
    return `x ${h.x}  y ${h.y}` + (rgb ? `   ·   R ${rgb[0]}  G ${rgb[1]}  B ${rgb[2]}` : "");
  }
  // frequency plane: Fourier views are centred, the DCT starts at the top-left
  let fx: number;
  let fy: number;
  if (h.view === "dct") {
    fx = h.x / (2 * h.width);
    fy = h.y / (2 * h.height);
  } else {
    fx = (h.x - Math.floor(h.width / 2)) / h.width;
    fy = (Math.floor(h.height / 2) - h.y) / h.height;
  }
  const f = Math.hypot(fx, fy);
  if (f === 0) return "Zero frequency (average brightness)";
  const angle = ((Math.atan2(fy, fx) * 180) / Math.PI + 360) % 180;
  return `${f.toFixed(3)} cycles/px   ·   repeats every ${(1 / f).toFixed(1)} px   ·   ${angle.toFixed(0)}°`;
}
