import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { applyColormap } from "../colormaps";
import type { ImageMeta } from "../types";

interface Slot {
  id: string;
  meta: ImageMeta;
  spectrum: ImageBitmap | null;
}

/** Side-by-side spectral comparison of two images + a difference map.
 * The classic use: a real photo vs. a generated/processed one. */
export default function ComparePage() {
  const [a, setA] = useState<Slot | null>(null);
  const [b, setB] = useState<Slot | null>(null);
  const [diff, setDiff] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<{ name: string }[]>([]);

  useEffect(() => {
    api.samples().then(setSamples).catch(() => {});
  }, []);

  const loadSlot = useCallback(async (which: "a" | "b", loader: Promise<{ id: string; meta: ImageMeta }>) => {
    try {
      const { id, meta } = await loader;
      const gray = await api.spectrum(id, {
        kind: "magnitude", channel: "luma", window: "hann",
        scale: "log", gamma: 0.5, clip_lo: 0.1, clip_hi: 99.9,
      });
      const spectrum = await applyColormap(gray, "viridis");
      (which === "a" ? setA : setB)({ id, meta, spectrum });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!a || !b) {
      setDiff(null);
      return;
    }
    let live = true;
    api
      .compareDiff(a.id, b.id, "luma")
      .then((gray) => applyColormap(gray, "diverging"))
      .then((bm) => live && setDiff(bm))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [a, b]);

  return (
    <div className="compare-page">
      {error && <div className="error-banner" onClick={() => setError(null)}>⚠ {error}</div>}
      <div className="compare-grid">
        <CompareSlot label="A" slot={a} samples={samples} onLoad={(l) => loadSlot("a", l)} />
        <CompareSlot label="B" slot={b} samples={samples} onLoad={(l) => loadSlot("b", l)} />
        <div className="compare-cell">
          <header><b>log |F(A)| − log |F(B)|</b></header>
          {diff ? (
            <>
              <BitmapView bitmap={diff} />
              <p className="muted small">
                red = A has more energy at that frequency · blue = B has more.
                A uniform red/blue ring at high frequencies is the classic signature of
                sharpening/synthetic content (red) or blur/upscaling (blue).
              </p>
            </>
          ) : (
            <p className="muted center">load both images to compare their spectra</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CompareSlot({ label, slot, samples, onLoad }: {
  label: string;
  slot: Slot | null;
  samples: { name: string }[];
  onLoad: (loader: Promise<{ id: string; meta: ImageMeta }>) => void;
}) {
  return (
    <div className="compare-cell">
      <header>
        <b>Image {label}</b>
        <label className="btn small">
          open
          <input type="file" accept="image/*,.tif,.tiff" hidden
            onChange={(e) => e.target.files?.[0] && onLoad(api.upload(e.target.files[0]))} />
        </label>
        <select value="" onChange={(e) => e.target.value && onLoad(api.loadSample(e.target.value))}>
          <option value="">samples…</option>
          {samples.map((s) => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
      </header>
      {slot?.spectrum ? (
        <>
          <BitmapView bitmap={slot.spectrum} />
          <p className="muted small">{slot.meta.filename} · {slot.meta.width}×{slot.meta.height}</p>
        </>
      ) : (
        <p className="muted center">no image loaded</p>
      )}
    </div>
  );
}

function BitmapView({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const size = 340;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const s = Math.min(size / bitmap.width, size / bitmap.height);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(
      bitmap,
      (size - bitmap.width * s) / 2,
      (size - bitmap.height * s) / 2,
      bitmap.width * s,
      bitmap.height * s,
    );
  }, [bitmap]);
  return <canvas ref={ref} className="compare-canvas" />;
}
