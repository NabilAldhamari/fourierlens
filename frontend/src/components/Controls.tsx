import { COLORMAP_NAMES, lutGradient } from "../colormaps";
import { useExplore } from "../store";
import type { Tool } from "../types";

const TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
  { id: "pan", label: "Pan", icon: "✋", hint: "Drag to pan, wheel to zoom (both panels)" },
  { id: "point", label: "Point", icon: "◉", hint: "Click a spectrum peak; its conjugate mirror is included automatically" },
  { id: "rect", label: "Rect", icon: "▭", hint: "Drag a rectangular frequency region" },
  { id: "ellipse", label: "Ellipse", icon: "◯", hint: "Drag an elliptical frequency region" },
  { id: "annulus", label: "Ring", icon: "◎", hint: "Drag outward from the inner to the outer radius (band-pass)" },
  { id: "wedge", label: "Wedge", icon: "◔", hint: "Drag to pick an orientation band" },
  { id: "brush", label: "Brush", icon: "🖌", hint: "Paint freehand over spectrum features" },
  { id: "roi", label: "Region FFT", icon: "⌗", hint: "Drag a rectangle on the IMAGE to see that region's local spectrum" },
  { id: "annotate", label: "Annotate", icon: "✎", hint: "Drag (or click) on either panel to pin a comment" },
];

export function Toolbar() {
  const { tool, set, clearSelections, selections, invert } = useExplore();
  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn ${tool === t.id ? "active" : ""}`}
          title={`${t.label} — ${t.hint}`}
          onClick={() => set({ tool: t.id })}
        >
          <span className="tool-icon">{t.icon}</span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
      <div className="toolbar-sep" />
      <label className="check" title="Select everything EXCEPT the drawn regions (notch filter)">
        <input type="checkbox" checked={invert} onChange={(e) => set({ invert: e.target.checked })} />
        invert
      </label>
      <button className="tool-btn danger" disabled={selections.length === 0} onClick={clearSelections}
        title="Remove all frequency selections">
        ✕ clear ({selections.length})
      </button>
    </div>
  );
}

function Select<T extends string>({ label, value, options, onChange, title, format }: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  title?: string;
  format?: (v: T) => string;
}) {
  return (
    <label className="ctl" title={title}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>{format ? format(o) : o}</option>
        ))}
      </select>
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange, title, display }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  title?: string;
  display?: string;
}) {
  return (
    <label className="ctl slider" title={title}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
      <em>{display ?? value}</em>
    </label>
  );
}

export function SpectrumControls({ windowDescriptions }: { windowDescriptions: Record<string, string> }) {
  const s = useExplore();
  return (
    <div className="controls-row">
      <Select label="view" value={s.kind} options={["magnitude", "phase", "psd"] as const}
        onChange={(kind) => s.set({ kind })}
        title="magnitude = |F| (most useful) · phase = where patterns sit · psd = |F|² power" />
      <Select label="channel" value={s.channel} options={["luma", "r", "g", "b"] as const}
        onChange={(channel) => s.set({ channel })}
        title="Which channel to transform. luma = perceptual brightness (Rec. 709)" />
      <Select label="window" value={s.window} options={["none", "hann", "hamming", "blackman", "tukey"] as const}
        onChange={(window) => s.set({ window })}
        title={windowDescriptions[s.window] ?? "Tapers borders to remove the spurious axis cross"} />
      <Select label="scale" value={s.scale} options={["log", "linear", "gamma"] as const}
        onChange={(scale) => s.set({ scale })}
        title="Transfer curve before display. log shows the full dynamic range" />
      {s.scale === "gamma" && (
        <Slider label="γ" value={s.gamma} min={0.05} max={1} step={0.05} onChange={(gamma) => s.set({ gamma })} />
      )}
      <Slider label="clip %" value={s.clipHi} min={95} max={100} step={0.1} onChange={(clipHi) => s.set({ clipHi })}
        title="Upper percentile clip — lower it to reveal faint structure" display={`${s.clipHi.toFixed(1)}`} />
      <Select label="colors" value={s.spectrumColormap} options={COLORMAP_NAMES as readonly string[]}
        onChange={(spectrumColormap) => s.set({ spectrumColormap })} />
      <span className="cmap-strip" style={{ background: lutGradient(s.spectrumColormap) }} />
    </div>
  );
}

export function OverlayControls() {
  const s = useExplore();
  const hasSelection = s.selections.length > 0 || s.invert;
  return (
    <div className="controls-row">
      <Select label="pixels show" value={s.pixelView}
        options={["original", "overlay", "filtered", "progressive"] as const}
        onChange={(pixelView) => s.set({ pixelView })}
        format={(v) =>
          ({ original: "original", overlay: "original + band overlay", filtered: "filtered (before/after)", progressive: "progressive rebuild" })[v]
        }
        title="What the left panel displays. Press V to cycle." />
      {s.pixelView === "overlay" && (
        <>
          <Slider label="opacity" value={s.overlayOpacity} min={0} max={1} step={0.02}
            onChange={(overlayOpacity) => s.set({ overlayOpacity })}
            display={`${Math.round(s.overlayOpacity * 100)}%`}
            title="Opacity of the band-energy overlay ( [ and ] keys )" />
          <Select label="overlay colors" value={s.overlayColormap} options={COLORMAP_NAMES as readonly string[]}
            onChange={(overlayColormap) => s.set({ overlayColormap })} />
          <span className="cmap-strip" style={{ background: lutGradient(s.overlayColormap) }} />
        </>
      )}
      {s.pixelView === "filtered" && (
        <Slider label="before/after" value={s.compareSlider} min={0} max={1} step={0.01}
          onChange={(compareSlider) => s.set({ compareSlider })}
          display="" title="Divider position: left = filtered, right = original" />
      )}
      {s.pixelView === "progressive" && (
        <Slider label="frequencies ≤" value={s.progressiveFraction} min={0.005} max={1} step={0.005}
          onChange={(progressiveFraction) => s.set({ progressiveFraction })}
          display={`${Math.round(s.progressiveFraction * 100)}% Nyq`}
          title="Rebuild the image using only frequencies up to this radius" />
      )}
      {(s.pixelView === "overlay" || s.pixelView === "filtered") && (
        <Slider label="mask soften" value={s.softPx} min={0} max={20} step={1}
          onChange={(softPx) => s.set({ softPx })} display={`${s.softPx}px`}
          title="Gaussian soft edge on the frequency mask (reduces ringing)" />
      )}
      {!hasSelection && s.pixelView !== "original" && s.pixelView !== "progressive" && (
        <span className="hint-inline">draw a selection on the spectrum →</span>
      )}
      {(s.tool === "point" || s.tool === "brush") && (
        <Slider label={s.tool === "point" ? "point r" : "brush r"} value={s.tool === "point" ? s.pointRadius : s.brushRadius}
          min={0.005} max={0.15} step={0.005}
          onChange={(v) => s.set(s.tool === "point" ? { pointRadius: v } : { brushRadius: v })}
          display={(s.tool === "point" ? s.pointRadius : s.brushRadius).toFixed(3)} />
      )}
      {s.tool === "wedge" && (
        <Slider label="wedge width" value={s.wedgeWidth} min={2} max={60} step={1}
          onChange={(wedgeWidth) => s.set({ wedgeWidth })} display={`${s.wedgeWidth}°`} />
      )}
    </div>
  );
}
